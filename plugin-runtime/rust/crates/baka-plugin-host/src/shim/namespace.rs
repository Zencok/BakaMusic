pub fn install_baka_namespace(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    let globals = ctx.globals();
    let baka = rquickjs::Object::new(ctx.clone())?;
    globals.set("__baka", baka)?;
    Ok(())
}
