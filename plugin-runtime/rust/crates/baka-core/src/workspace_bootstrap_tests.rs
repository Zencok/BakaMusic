use super::*;

#[test]
fn local_bootstrap_retains_device_intent_and_never_admits_before_runtime_activation() {
    for (startup, last, target) in [
        ("local", "online", "local"),
        ("rememberLast", "online", "online"),
        ("rememberLast", "local", "local"),
        ("online", "local", "online"),
        ("online", "online", "online"),
    ] {
        let prefs =
            json!({"version":1,"onlineUnlocked":true,"startupMode":startup,"lastMode":last});
        let mut state = Workspace::default();
        let restored = state
            .command(
                json!({"version":1,"command":{"op":"restoreLocalDeferred","preferences":prefs}}),
            )
            .unwrap();
        assert_eq!(restored["preferences"], prefs);
        assert_eq!(restored["startupTarget"], target);
        assert_eq!(restored["activeMode"], "local");
        assert_eq!(restored["activationPending"], true);
        assert!(!state.network_allowed());
        assert!(state.permit(NetworkCapability::Plugin).is_err());
        assert!(state.restore_local_deferred(Value::Null).is_err());
        assert!(state.activate_restored("0").is_err());
        state
            .activate_restored(restored["revision"].as_str().unwrap())
            .unwrap();
        assert!(!state.network_allowed());
        assert_eq!(state.snapshot()["preferences"], prefs);
        assert!(state.permit(NetworkCapability::CloudLibrary).is_err());
        let mode = if target == "online" {
            Mode::Online
        } else {
            Mode::Local
        };
        state
            .commit(&state.revision.to_string(), Transition::Switch { mode })
            .unwrap();
        assert_eq!(state.network_allowed(), target == "online");
    }
}

#[test]
fn corrupt_or_absent_bootstrap_is_local_and_legacy_restore_still_resolves_intent() {
    for raw in [
        Value::Null,
        json!("invalid"),
        json!({"version":1,"onlineUnlocked":false,"startupMode":"rememberLast","lastMode":"online"}),
    ] {
        let mut state = Workspace::default();
        state.restore_local_deferred(raw).unwrap();
        let result = state.activate_restored("1").unwrap();
        assert_eq!(result["startupTarget"], "local");
        assert_eq!(result["activeMode"], "local");
        assert_eq!(result["preferences"]["onlineUnlocked"], false);
        assert!(!state.network_allowed());
    }
    let mut legacy = Workspace::default();
    legacy.restore_deferred(json!({"version":1,"onlineUnlocked":true,"startupMode":"rememberLast","lastMode":"online"})).unwrap();
    assert!(!legacy.network_allowed());
    legacy.activate_restored("1").unwrap();
    assert!(legacy.network_allowed());
    assert_eq!(legacy.snapshot()["startupTarget"], "online");
}
