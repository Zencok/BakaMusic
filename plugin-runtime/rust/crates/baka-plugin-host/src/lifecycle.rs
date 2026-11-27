//! Terminal cancellation for one JavaScript context, independent of request HTTP.
use futures_util::future::{AbortHandle, Abortable};
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Default)]
struct State {
    next: u64,
    active: HashMap<u64, AbortHandle>,
}

#[derive(Default)]
pub(super) struct Lifecycle {
    stopped: AtomicBool,
    state: Mutex<State>,
}

struct Registration {
    owner: Arc<Lifecycle>,
    id: u64,
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.owner
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .active
            .remove(&self.id);
    }
}

impl Lifecycle {
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        let handles = {
            let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
            std::mem::take(&mut state.active)
        };
        // Wake callers outside the registry lock: cancellation drops registrations.
        for handle in handles.into_values() {
            handle.abort();
        }
    }

    pub async fn run<T>(self: &Arc<Self>, work: impl Future<Output = T>) -> Result<T, ()> {
        let (registration, cancellation) = {
            let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
            if self.is_stopped() {
                return Err(());
            }
            let next = state.next.checked_add(1).ok_or(())?;
            state.next = next;
            let (handle, cancellation) = AbortHandle::new_pair();
            state.active.insert(next, handle);
            (
                Registration {
                    owner: self.clone(),
                    id: next,
                },
                cancellation,
            )
        };
        let result = Abortable::new(work, cancellation).await.map_err(|_| ());
        drop(registration);
        // A finished future must not publish after a racing terminal shutdown.
        if self.is_stopped() {
            return Err(());
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::task::Context;
    #[tokio::test]
    async fn stop_cancels_waiters_and_never_polls_future_work() {
        let owner = Arc::new(Lifecycle::default());
        let pending = owner.run(std::future::pending::<()>());
        let mut pending = std::pin::pin!(pending);
        assert!(
            pending
                .as_mut()
                .poll(&mut Context::from_waker(
                    futures_util::task::noop_waker_ref()
                ))
                .is_pending()
        );
        owner.stop();
        owner.stop();
        assert_eq!(pending.await, Err(()));
        let polled = AtomicBool::new(false);
        assert_eq!(
            owner
                .run(async {
                    polled.store(true, Ordering::Relaxed);
                })
                .await,
            Err(())
        );
        assert!(!polled.load(Ordering::Relaxed));
        assert!(owner.state.lock().unwrap().active.is_empty());
    }

    #[tokio::test]
    async fn shutdown_during_completion_rejects_result() {
        let owner = Arc::new(Lifecycle::default());
        assert_eq!(
            owner
                .run(async {
                    owner.stop();
                    42
                })
                .await,
            Err(())
        );
        assert!(owner.state.lock().unwrap().active.is_empty());
    }
}
