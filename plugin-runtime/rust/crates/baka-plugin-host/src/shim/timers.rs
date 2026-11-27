//! Native cancellable waits shared by the JS timeout/interval protocol glue.
use super::cancellation::Cancellations;
use futures_util::future::Abortable;
use rquickjs::{
    Ctx,
    function::{Async, Func},
};
use std::time::Duration;

pub(super) fn install(
    ctx: &Ctx<'_>,
    scopes: crate::call_scope::CallScopes,
) -> rquickjs::Result<()> {
    let baka: rquickjs::Object = ctx.globals().get("__baka")?;
    let waits = Cancellations::default();
    let cancel = waits.clone();
    baka.set("timer_cancel", Func::from(move |id: u64| cancel.cancel(id)))?;
    baka.set(
        "timer_wait",
        Func::from(Async(move |ctx: Ctx<'_>, id: u64, ms: u64| {
            let (guard, registration) = waits.register(id);
            let task = scopes.start(&ctx, async move {
                let _guard = guard;
                Abortable::new(
                    futures_timer::Delay::new(Duration::from_millis(ms)),
                    registration,
                )
                .await
                .is_ok()
            });
            async move { task.await.unwrap_or(false) }
        })),
    )?;
    Ok(())
}
