//! Native I/O ownership follows an opaque engine job context across await/then.
//! No JS values or runtime pointers live across an await or outside the JS lock.
use rquickjs::{Ctx, qjs};
use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    task::{Context, Poll},
};
use tokio::task::{AbortHandle, JoinHandle};

unsafe extern "C" {
    // Private extensions supplied by our vendored QuickJS on every target.
    fn JS_GetHostJobContext(rt: *mut qjs::JSRuntime) -> u64;
    fn JS_SetHostJobContext(rt: *mut qjs::JSRuntime, context: u64) -> u64;
}

#[derive(Default)]
struct State {
    stopped: bool,
    next: u64,
    tasks: HashMap<u64, AbortHandle>,
}
#[derive(Default)]
struct Scope(Mutex<State>);
impl Scope {
    fn cancel(&self) {
        let tasks = {
            let mut state = self.0.lock().unwrap_or_else(|p| p.into_inner());
            state.stopped = true;
            std::mem::take(&mut state.tasks)
        };
        for task in tasks.into_values() {
            task.abort();
        }
    }
    fn start<T: Send + 'static>(
        self: &Arc<Self>,
        work: impl Future<Output = T> + Send + 'static,
    ) -> ScopedTask<T> {
        let mut state = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if state.stopped {
            return ScopedTask::cancelled();
        }
        let Some(next) = state.next.checked_add(1) else {
            return ScopedTask::cancelled();
        };
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return ScopedTask::cancelled();
        };
        state.next = next;
        // Admission and task registration are atomic with respect to cancel.
        let task = runtime.spawn(work);
        state.tasks.insert(next, task.abort_handle());
        ScopedTask {
            task: Some(task),
            registration: Some((self.clone(), next)),
        }
    }
}

#[derive(Default)]
struct Registry {
    stopped: AtomicBool,
    next: AtomicU64,
    calls: Mutex<HashMap<u64, Weak<Scope>>>,
    background: Arc<Scope>,
}
#[derive(Clone, Default)]
pub(crate) struct CallScopes(Arc<Registry>);
pub(crate) struct CallOwner {
    scopes: CallScopes,
    scope: Arc<Scope>,
    pub id: u64,
}
impl Drop for CallOwner {
    fn drop(&mut self) {
        self.scopes
            .0
            .calls
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&self.id);
        self.scope.cancel();
    }
}
impl CallScopes {
    pub fn begin(&self) -> CallOwner {
        let id = self
            .0
            .next
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
            .expect("plugin call context exhausted")
            + 1;
        let scope = Arc::new(Scope::default());
        let mut calls = self.0.calls.lock().unwrap_or_else(|p| p.into_inner());
        if self.0.stopped.load(Ordering::Acquire) {
            scope.cancel();
        } else {
            calls.insert(id, Arc::downgrade(&scope));
        }
        CallOwner {
            scopes: self.clone(),
            scope,
            id,
        }
    }
    pub fn stop(&self) {
        self.0.stopped.store(true, Ordering::Release);
        self.0.background.cancel();
        let scopes: Vec<_> = self
            .0
            .calls
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .values()
            .filter_map(Weak::upgrade)
            .collect();
        for scope in scopes {
            scope.cancel();
        }
    }
    pub fn start<T: Send + 'static>(
        &self,
        ctx: &Ctx<'_>,
        work: impl Future<Output = T> + Send + 'static,
    ) -> ScopedTask<T> {
        if self.0.stopped.load(Ordering::Acquire) {
            return ScopedTask::cancelled();
        }
        // SAFETY: Ctx is live and its runtime lock is held by the native call.
        let id = unsafe { JS_GetHostJobContext(qjs::JS_GetRuntime(ctx.as_raw().as_ptr())) };
        let scope = if id == 0 {
            Some(self.0.background.clone())
        } else {
            self.0
                .calls
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .get(&id)
                .and_then(Weak::upgrade)
        };
        match scope {
            Some(scope) => scope.start(work),
            // Retired contexts must never become background work.
            None => ScopedTask::cancelled(),
        }
    }
}

pub(crate) struct ScopedTask<T> {
    task: Option<JoinHandle<T>>,
    registration: Option<(Arc<Scope>, u64)>,
}
impl<T> ScopedTask<T> {
    fn cancelled() -> Self {
        Self {
            task: None,
            registration: None,
        }
    }
}
impl<T> Future for ScopedTask<T> {
    type Output = Result<T, &'static str>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match &mut self.get_mut().task {
            Some(task) => Pin::new(task).poll(cx).map(|result| {
                result.map_err(|error| {
                    if error.is_cancelled() {
                        "plugin_call_cancelled"
                    } else {
                        "plugin_call_task_failed"
                    }
                })
            }),
            None => Poll::Ready(Err("plugin_call_cancelled")),
        }
    }
}
impl<T> Drop for ScopedTask<T> {
    fn drop(&mut self) {
        if let Some((scope, id)) = self.registration.take() {
            scope
                .0
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .tasks
                .remove(&id);
        }
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

/// Used only synchronously inside AsyncContext::with; restores nested entries.
pub(crate) struct EnteredContext<'a, 'js> {
    ctx: &'a Ctx<'js>,
    previous: u64,
}
impl<'a, 'js> EnteredContext<'a, 'js> {
    pub fn new(ctx: &'a Ctx<'js>, id: u64) -> Self {
        // SAFETY: scope cannot escape the Ctx borrow / runtime lock.
        let previous =
            unsafe { JS_SetHostJobContext(qjs::JS_GetRuntime(ctx.as_raw().as_ptr()), id) };
        Self { ctx, previous }
    }
}
impl Drop for EnteredContext<'_, '_> {
    fn drop(&mut self) {
        // SAFETY: same locked Ctx as at entry; no raw pointer is retained.
        unsafe {
            JS_SetHostJobContext(
                qjs::JS_GetRuntime(self.ctx.as_raw().as_ptr()),
                self.previous,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct OnDrop(Option<tokio::sync::oneshot::Sender<()>>);
    impl Drop for OnDrop {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }

    #[tokio::test]
    async fn cancel_disposes_native_work_even_when_its_js_waiter_is_never_polled() {
        let scopes = CallScopes::default();
        let owner = scopes.begin();
        let (started, ready) = tokio::sync::oneshot::channel();
        let (stopped, done) = tokio::sync::oneshot::channel();
        let task = owner.scope.start(async move {
            let _drop = OnDrop(Some(stopped));
            let _ = started.send(());
            std::future::pending::<()>().await;
        });
        tokio::time::timeout(Duration::from_secs(1), ready)
            .await
            .unwrap()
            .unwrap();
        // ScopedTask (the JS promise's native waiter) has never been polled.
        drop(owner);
        tokio::time::timeout(Duration::from_secs(1), done)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(task.await, Err("plugin_call_cancelled"));
        assert!(scopes.0.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn terminal_shutdown_rejects_new_call_and_background_admission() {
        let scopes = CallScopes::default();
        scopes.stop();
        scopes.stop();
        let owner = scopes.begin();
        assert_eq!(
            owner
                .scope
                .start(async { panic!("retired call was polled") })
                .await,
            Err::<(), _>("plugin_call_cancelled")
        );
        assert_eq!(
            scopes
                .0
                .background
                .start(async { panic!("stopped background was polled") })
                .await,
            Err::<(), _>("plugin_call_cancelled")
        );
        assert!(scopes.0.calls.lock().unwrap().is_empty());
    }
}
