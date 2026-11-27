//! Per-context cancellation. Register before returning a JS promise so cancelling
//! immediately also works before the native future has ever been polled.
use futures_util::future::{AbortHandle, AbortRegistration};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub(super) struct Cancellations(Arc<Mutex<HashMap<u64, AbortHandle>>>);

pub(super) struct Registration {
    owner: Cancellations,
    id: u64,
}

impl Cancellations {
    pub fn register(&self, id: u64) -> (Registration, AbortRegistration) {
        let (handle, registration) = AbortHandle::new_pair();
        if let Some(previous) = self.0.lock().unwrap().insert(id, handle) {
            previous.abort();
        }
        (
            Registration {
                owner: self.clone(),
                id,
            },
            registration,
        )
    }

    pub fn cancel(&self, id: u64) {
        if let Some(handle) = self.0.lock().unwrap().get(&id) {
            handle.abort();
        }
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.owner.0.lock().unwrap().remove(&self.id);
    }
}
