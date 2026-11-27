//! Validated V2 package identity contracts, staged independently of the runtime.
//!
//! These owned snapshots do not install packages or change the current registry.
//! Deserialization validates the same invariants as explicit construction; private
//! fields prevent callers from mutating a validated manifest into an invalid one.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub const SUPPORTED_CAPABILITIES: &[&str] = &[
    "search",
    "entities.get",
    "collections.get",
    "collections.members",
    "discovery.charts",
    "discovery.chartTags",
    "discovery.playlistTags",
    "discovery.playlists",
    "discovery.hotSearch",
    "discovery.recommendations",
    "discovery.daily",
    "discovery.similar",
    "discovery.searchSuggestions",
    "media.prepare",
    "media.resolve",
    "media.video",
    "media.license",
    "lyrics.get",
    "comments.list",
    "links.resolve",
    "links.share",
    "recognition.identify",
    "auth.login",
    "auth.callback",
    "auth.logout",
    "auth.status",
];

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid V2 contract: {0}")]
pub struct ContractError(pub String);

fn invalid(message: &str) -> ContractError {
    ContractError(message.into())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageKind {
    Provider,
    Resolver,
}

/// Wire metadata remains complete, including fields unknown to this host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFields {
    api_version: u32,
    kind: PackageKind,
    id: String,
    name: String,
    author: String,
    version: String,
    capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sources: Option<Vec<String>>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "Value", into = "Value")]
pub struct PackageManifest(ManifestFields);

impl PackageManifest {
    pub fn from_value(value: Value) -> Result<Self, ContractError> {
        Self::try_from(value)
    }
    pub fn id(&self) -> &str {
        &self.0.id
    }
    pub fn kind(&self) -> PackageKind {
        self.0.kind
    }
    pub fn name(&self) -> &str {
        &self.0.name
    }
    pub fn author(&self) -> &str {
        &self.0.author
    }
    pub fn version(&self) -> &str {
        &self.0.version
    }
    pub fn capabilities(&self) -> &[String] {
        &self.0.capabilities
    }
    pub fn source_id(&self) -> Option<&str> {
        self.0.source_id.as_deref()
    }
    pub fn sources(&self) -> Option<&[String]> {
        self.0.sources.as_deref()
    }
    pub fn metadata(&self) -> &Map<String, Value> {
        &self.0.extra
    }
}

impl From<PackageManifest> for Value {
    fn from(value: PackageManifest) -> Self {
        serde_json::to_value(value.0).expect("validated JSON manifest is serializable")
    }
}

impl TryFrom<Value> for PackageManifest {
    type Error = ContractError;
    fn try_from(mut value: Value) -> Result<Self, Self::Error> {
        let object = value
            .as_object()
            .ok_or_else(|| invalid("manifest must be an object"))?;
        for forbidden in ["legacyPlatforms", "platform", "providerId"] {
            if object.contains_key(forbidden) {
                return Err(invalid("deprecated manifest identity field"));
            }
        }
        // Presence, including explicit null, is forbidden for the other kind.
        match object.get("kind").and_then(Value::as_str) {
            Some("provider") if object.contains_key("sources") => {
                return Err(invalid("provider cannot declare sources"));
            }
            Some("resolver") if object.contains_key("sourceId") => {
                return Err(invalid("resolver cannot declare sourceId"));
            }
            _ => {}
        }
        // Evaluated JavaScript represents 2, 2.0 and 2e0 identically.
        if value.get("apiVersion").and_then(Value::as_f64) != Some(2.0) {
            return Err(invalid("apiVersion must be 2"));
        }
        value["apiVersion"] = Value::from(2);
        let fields: ManifestFields =
            serde_json::from_value(value).map_err(|error| ContractError(error.to_string()))?;
        if fields.api_version != 2 {
            return Err(invalid("apiVersion must be 2"));
        }
        if !valid_package_id(&fields.id) {
            return Err(invalid("invalid package id"));
        }
        if !valid_text(&fields.name, 128) || !valid_text(&fields.author, 256) {
            return Err(invalid("invalid name or author"));
        }
        if !valid_semver(&fields.version) {
            return Err(invalid("invalid semantic version"));
        }
        if fields.capabilities.is_empty()
            || !unique(&fields.capabilities)
            || fields
                .capabilities
                .iter()
                .any(|cap| !SUPPORTED_CAPABILITIES.contains(&cap.as_str()))
        {
            return Err(invalid(
                "capabilities must be supported, nonempty and unique",
            ));
        }
        match fields.kind {
            PackageKind::Provider => {
                if !fields.source_id.as_deref().is_some_and(valid_source_id) {
                    return Err(invalid("provider requires canonical sourceId"));
                }
            }
            PackageKind::Resolver => {
                let sources = fields
                    .sources
                    .as_ref()
                    .ok_or_else(|| invalid("resolver requires sources"))?;
                if sources.is_empty()
                    || !unique(sources)
                    || sources.iter().any(|s| !valid_source_id(s))
                {
                    return Err(invalid(
                        "resolver sources must be canonical, nonempty and unique",
                    ));
                }
                if !fields.capabilities.iter().any(|cap| cap == "media.resolve")
                    || fields.capabilities.iter().any(|cap| {
                        !matches!(
                            cap.as_str(),
                            "media.resolve" | "media.video" | "media.license"
                        )
                    })
                {
                    return Err(invalid(
                        "resolver requires media.resolve and only media capabilities",
                    ));
                }
            }
        }
        Ok(Self(fields))
    }
}

fn unique(values: &[String]) -> bool {
    values.iter().collect::<HashSet<_>>().len() == values.len()
}
fn valid_text(value: &str, max: usize) -> bool {
    value.chars().any(|c| !c.is_whitespace() && c != '\u{feff}') && value.chars().count() <= max
}

pub fn valid_package_id(value: &str) -> bool {
    value.len() <= 128
        && value.contains('.')
        && value.split('.').all(|part| {
            part.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}

pub fn valid_source_id(value: &str) -> bool {
    value.len() <= 64
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value.split(['.', '-']).all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

/// SemVer 2.0 grammar without integer parsing, so large valid components survive.
fn valid_semver(value: &str) -> bool {
    let mut build_parts = value.split('+');
    let core_pre = build_parts.next().unwrap_or_default();
    if let Some(build) = build_parts.next() {
        if !valid_version_identifiers(build, false) || build_parts.next().is_some() {
            return false;
        }
    }
    let (core, pre) = match core_pre.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (core_pre, None),
    };
    let numbers: Vec<_> = core.split('.').collect();
    numbers.len() == 3
        && numbers.iter().all(|part| valid_numeric_identifier(part))
        && pre.is_none_or(|pre| valid_version_identifiers(pre, true))
}

fn valid_numeric_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|c| c.is_ascii_digit())
        && (value.len() == 1 || !value.starts_with('0'))
}
fn valid_version_identifiers(value: &str, prerelease: bool) -> bool {
    value.split('.').all(|part| {
        !part.is_empty()
            && part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
            && (!prerelease
                || !part.bytes().all(|c| c.is_ascii_digit())
                || valid_numeric_identifier(part))
    })
}

/// Explicit enabled registry snapshot supplied by the caller; no URL/name lookup.
#[derive(Debug, Clone)]
pub struct RegisteredPackage {
    pub manifest: PackageManifest,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    deny_unknown_fields,
    try_from = "BindingFields",
    into = "BindingFields"
)]
pub struct ResolverBinding {
    provider_id: String,
    resolver_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BindingFields {
    provider_id: String,
    resolver_id: String,
}

impl TryFrom<BindingFields> for ResolverBinding {
    type Error = ContractError;
    fn try_from(fields: BindingFields) -> Result<Self, Self::Error> {
        Self::new(fields.provider_id, fields.resolver_id)
    }
}
impl From<ResolverBinding> for BindingFields {
    fn from(value: ResolverBinding) -> Self {
        Self {
            provider_id: value.provider_id,
            resolver_id: value.resolver_id,
        }
    }
}
impl ResolverBinding {
    pub fn new(provider_id: String, resolver_id: String) -> Result<Self, ContractError> {
        if !valid_package_id(&provider_id) || !valid_package_id(&resolver_id) {
            return Err(invalid("binding requires exact package ids"));
        }
        Ok(Self {
            provider_id,
            resolver_id,
        })
    }
    pub fn provider_id(&self) -> &str {
        &self.provider_id
    }
    pub fn resolver_id(&self) -> &str {
        &self.resolver_id
    }
    pub fn validate(&self, registry: &[RegisteredPackage]) -> Result<(), ContractError> {
        let mut ids = HashSet::new();
        if registry.iter().any(|item| !ids.insert(item.manifest.id())) {
            return Err(invalid("ambiguous duplicate package id"));
        }
        let find = |id: &str| -> Result<&RegisteredPackage, ContractError> {
            let mut matches = registry.iter().filter(|item| item.manifest.id() == id);
            let item = matches
                .next()
                .ok_or_else(|| invalid("bound package missing"))?;
            if !item.enabled {
                return Err(invalid("bound package disabled"));
            }
            Ok(item)
        };
        let provider = &find(&self.provider_id)?.manifest;
        let resolver = &find(&self.resolver_id)?.manifest;
        if provider.kind() != PackageKind::Provider || resolver.kind() != PackageKind::Resolver {
            return Err(invalid("binding package kinds do not match"));
        }
        if !provider
            .capabilities()
            .iter()
            .any(|cap| cap == "media.prepare")
        {
            return Err(invalid("bound provider requires media.prepare"));
        }
        if !resolver
            .sources()
            .unwrap_or_default()
            .iter()
            .any(|source| Some(source.as_str()) == provider.source_id())
        {
            return Err(invalid("resolver does not support provider sourceId"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    Music,
    Album,
    Artist,
    Sheet,
    Lyric,
    Chart,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "Value", into = "Value")]
pub struct EntityId(EntityIdValue);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum EntityIdValue {
    String(String),
    Integer(i64),
}

impl TryFrom<Value> for EntityId {
    type Error = ContractError;
    fn try_from(value: Value) -> Result<Self, Self::Error> {
        match value {
            Value::String(text) if !text.is_empty() => Ok(Self(EntityIdValue::String(text))),
            Value::Number(number)
                if number
                    .as_i64()
                    .is_some_and(|n| n.unsigned_abs() <= 9_007_199_254_740_991) =>
            {
                Ok(Self(EntityIdValue::Integer(number.as_i64().unwrap())))
            }
            Value::Number(number)
                if number.as_f64().is_some_and(|n| {
                    n.is_finite() && n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0
                }) =>
            {
                Ok(Self(
                    EntityIdValue::Integer(number.as_f64().unwrap() as i64),
                ))
            }
            _ => Err(invalid(
                "entity id must be nonempty string or safe JSON integer",
            )),
        }
    }
}
impl From<EntityId> for Value {
    fn from(value: EntityId) -> Self {
        match value.0 {
            EntityIdValue::String(text) => Value::String(text),
            EntityIdValue::Integer(n) => n.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "EntityFields", into = "EntityFields")]
pub struct EntityRef {
    provider_id: String,
    kind: EntityKind,
    id: EntityId,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntityFields {
    provider_id: String,
    kind: EntityKind,
    id: EntityId,
}

impl TryFrom<EntityFields> for EntityRef {
    type Error = ContractError;
    fn try_from(value: EntityFields) -> Result<Self, Self::Error> {
        Self::new(value.provider_id, value.kind, value.id)
    }
}
impl From<EntityRef> for EntityFields {
    fn from(value: EntityRef) -> Self {
        Self {
            provider_id: value.provider_id,
            kind: value.kind,
            id: value.id,
        }
    }
}
impl EntityRef {
    pub fn new(provider_id: String, kind: EntityKind, id: EntityId) -> Result<Self, ContractError> {
        if !valid_package_id(&provider_id) {
            return Err(invalid("entity requires canonical providerId"));
        }
        // Validate explicitly constructed enum values as well as JSON input.
        let id = EntityId::try_from(Value::from(id))?;
        Ok(Self {
            provider_id,
            kind,
            id,
        })
    }
    pub fn provider_id(&self) -> &str {
        &self.provider_id
    }
    pub fn kind(&self) -> EntityKind {
        self.kind
    }
    pub fn id(&self) -> &EntityId {
        &self.id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plugin_contract_shared_authoring_vectors() {
        let vectors: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../docs/design/plugin-v2/authoring/contract-vectors.json"
        )))
        .unwrap();
        for manifest in vectors["validManifests"].as_array().unwrap() {
            let validated = PackageManifest::from_value(manifest.clone()).unwrap();
            let mut normalized = manifest.clone();
            normalized["apiVersion"] = json!(2);
            assert_eq!(serde_json::to_value(&validated).unwrap(), normalized);
            assert!(serde_json::from_str::<PackageManifest>(&manifest.to_string()).is_ok());
        }
        for case in vectors["invalidManifests"].as_array().unwrap() {
            assert!(
                PackageManifest::from_value(case["manifest"].clone()).is_err(),
                "{}",
                case["name"]
            );
            assert!(
                serde_json::from_value::<PackageManifest>(case["manifest"].clone()).is_err(),
                "{}",
                case["name"]
            );
        }
        for entity in vectors["validEntityRefs"].as_array().unwrap() {
            let validated: EntityRef = serde_json::from_value(entity.clone()).unwrap();
            let mut normalized = entity.clone();
            if let Some(number) = normalized["id"].as_f64() {
                normalized["id"] = json!(number as i64);
            }
            assert_eq!(serde_json::to_value(validated).unwrap(), normalized);
        }
        for case in vectors["invalidEntityRefs"].as_array().unwrap() {
            assert!(
                serde_json::from_value::<EntityRef>(case["entityRef"].clone()).is_err(),
                "{}",
                case["name"]
            );
        }
    }

    fn provider() -> Value {
        json!({"apiVersion":2,"kind":"provider","id":"org.example.catalog",
            "name":"Catalog","author":"Original author","version":"1.0.0",
            "sourceId":"music.v2-test","capabilities":["search","media.prepare"]})
    }
    fn resolver() -> Value {
        json!({"apiVersion":2,"kind":"resolver","id":"org.example.resolver",
            "name":"Resolver","author":"Resolver author","version":"2.0.0-beta.1+build.001",
            "sources":["music.v2-test"],"capabilities":["media.resolve","media.license"]})
    }
    fn package(value: Value) -> RegisteredPackage {
        RegisteredPackage {
            manifest: PackageManifest::from_value(value).unwrap(),
            enabled: true,
        }
    }

    #[test]
    fn plugin_contract_metadata_roundtrip_is_complete_and_owned() {
        let mut original = provider();
        original["description"] = json!("Unabridged description");
        original["hints"] = json!({"login":"Help", "nested":[1,null,{"key":true}]});
        original["userVariables"] = json!([{"name":"token","help":"Keep this help"}]);
        original["provenance"] = json!({"author":"Upstream", "license":"custom"});
        let manifest: PackageManifest = serde_json::from_value(original.clone()).unwrap();
        assert_eq!(serde_json::to_value(&manifest).unwrap(), original);
        original["hints"]["login"] = json!("mutated");
        assert_eq!(manifest.metadata()["hints"]["login"], "Help");
        assert_eq!(manifest.id(), "org.example.catalog");
        let mut changed_display = provider();
        changed_display["name"] = json!("A renamed catalog");
        changed_display["homepage"] = json!("https://another.example/script");
        assert_eq!(
            PackageManifest::from_value(changed_display).unwrap().id(),
            manifest.id()
        );
    }

    #[test]
    fn plugin_contract_rejects_invalid_manifest_at_every_json_boundary() {
        let invalid_fields = [
            ("apiVersion", json!(1)),
            ("kind", json!("legacy")),
            ("id", json!("catalog")),
            ("id", json!("org.Example.music")),
            ("id", json!("org.example/route")),
            ("id", json!("org.例子")),
            ("name", json!("  \n")),
            ("author", json!("")),
            ("name", json!("x".repeat(129))),
            ("author", json!("x".repeat(257))),
            ("capabilities", json!([])),
            ("capabilities", json!(["search", "search"])),
            ("capabilities", json!(["unknown"])),
            ("capabilities", json!([3])),
            ("sourceId", json!("Music")),
            ("sourceId", json!("a..b")),
            ("sourceId", json!("a--b")),
            ("sourceId", json!("a-")),
            ("sourceId", json!("a".repeat(65))),
            ("sources", Value::Null),
            ("platform", Value::Null),
            ("providerId", json!("org.example.other")),
            ("legacyPlatforms", json!([])),
        ];
        for (key, value) in invalid_fields {
            let mut manifest = provider();
            manifest[key] = value;
            assert!(
                PackageManifest::from_value(manifest.clone()).is_err(),
                "{manifest}"
            );
            assert!(
                serde_json::from_value::<PackageManifest>(manifest.clone()).is_err(),
                "{manifest}"
            );
            assert!(
                serde_json::from_str::<PackageManifest>(&manifest.to_string()).is_err(),
                "{manifest}"
            );
        }
        for key in [
            "apiVersion",
            "kind",
            "id",
            "name",
            "author",
            "version",
            "capabilities",
            "sourceId",
        ] {
            let mut manifest = provider();
            manifest.as_object_mut().unwrap().remove(key);
            assert!(
                serde_json::from_value::<PackageManifest>(manifest).is_err(),
                "missing {key}"
            );
        }
        for (key, value) in [
            ("sources", json!([])),
            ("sources", json!(["music", "music"])),
            ("sources", json!(["music", "bad-"])),
            ("sourceId", Value::Null),
            ("capabilities", json!(["media.video"])),
            ("capabilities", json!(["media.resolve", "search"])),
            ("capabilities", json!(["media.resolve", "media.prepare"])),
        ] {
            let mut manifest = resolver();
            manifest[key] = value;
            assert!(
                serde_json::from_value::<PackageManifest>(manifest).is_err(),
                "resolver {key}"
            );
        }
    }

    #[test]
    fn plugin_contract_semver_and_identifier_edges() {
        for version in [
            "0.0.0",
            "1.2.3-alpha-1.0+001.A-b",
            "999999999999999999999.1.0",
            "1.0.0--",
        ] {
            assert!(valid_semver(version), "{version}");
        }
        for version in [
            "1.0",
            "v1.0.0",
            "01.0.0",
            "1.00.0",
            "1.0.0-01",
            "1.0.0-alpha.01",
            "1.0.0-",
            "1.0.0+",
            "1.0.0-a..b",
            "1.0.0+a+b",
            "1.0.0-ä",
            "1.0.0 ",
            "1.0.0+build/",
        ] {
            let mut manifest = provider();
            manifest["version"] = json!(version);
            assert!(
                serde_json::from_value::<PackageManifest>(manifest).is_err(),
                "{version}"
            );
        }
        assert!(valid_package_id(&format!("a.{}", "b".repeat(126))));
        assert!(!valid_package_id(&format!("a.{}", "b".repeat(127))));
        assert!(valid_source_id(&format!("a{}", "1".repeat(63))));
        for source in ["a.1", "a-1", "a1.b2-3"] {
            assert!(valid_source_id(source));
        }
        let mut unicode_name = provider();
        unicode_name["name"] = json!("🎵".repeat(128));
        assert!(PackageManifest::from_value(unicode_name).is_ok());
    }

    #[test]
    fn plugin_contract_binding_requires_enabled_exact_compatible_packages() {
        let binding =
            ResolverBinding::new("org.example.catalog".into(), "org.example.resolver".into())
                .unwrap();
        let registry = vec![package(provider()), package(resolver())];
        assert!(binding.validate(&registry).is_ok());
        assert_eq!(
            serde_json::from_value::<ResolverBinding>(serde_json::to_value(&binding).unwrap())
                .unwrap(),
            binding
        );
        assert!(binding.validate(&registry[..1]).is_err());
        for index in 0..2 {
            let mut disabled = registry.clone();
            disabled[index].enabled = false;
            assert!(binding.validate(&disabled).is_err());
        }
        let mut duplicate = registry.clone();
        duplicate.push(registry[0].clone());
        assert!(binding.validate(&duplicate).is_err());
        let mut unrelated_package = provider();
        unrelated_package["id"] = json!("org.example.unrelated");
        let unrelated_package = package(unrelated_package);
        let mut unrelated_duplicate = registry.clone();
        unrelated_duplicate.extend([unrelated_package.clone(), unrelated_package]);
        assert!(binding.validate(&unrelated_duplicate).is_err());
        let mut incompatible = resolver();
        incompatible["sources"] = json!(["other.source"]);
        assert!(
            binding
                .validate(&[package(provider()), package(incompatible)])
                .is_err()
        );
        let mut no_prepare = provider();
        no_prepare["capabilities"] = json!(["search"]);
        assert!(
            binding
                .validate(&[package(no_prepare), package(resolver())])
                .is_err()
        );
        let reversed =
            ResolverBinding::new("org.example.resolver".into(), "org.example.catalog".into())
                .unwrap();
        assert!(reversed.validate(&registry).is_err());
        let unrelated =
            ResolverBinding::new("org.other.catalog".into(), "org.example.resolver".into())
                .unwrap();
        assert!(unrelated.validate(&registry).is_err());
        for invalid_binding in [
            json!({"providerId":"Catalog","resolverId":"org.example.resolver"}),
            json!({"providerId":"org.example.catalog","resolverId":"https://example/script"}),
            json!({"providerId":"org.example.catalog","resolverId":"org.example.resolver","name":"Catalog"}),
        ] {
            assert!(serde_json::from_value::<ResolverBinding>(invalid_binding).is_err());
        }
    }

    #[test]
    fn plugin_contract_entity_ownership_preserves_scalar_types() {
        let make = |id: Value| json!({"providerId":"org.example.catalog","kind":"music","id":id});
        let integer: EntityRef = serde_json::from_value(make(json!(7))).unwrap();
        let string: EntityRef = serde_json::from_value(make(json!("7"))).unwrap();
        assert_ne!(integer, string);
        assert_eq!(serde_json::to_value(integer).unwrap(), make(json!(7)));
        assert_eq!(serde_json::to_value(string).unwrap(), make(json!("7")));
        for id in [
            json!(0),
            json!(-9_007_199_254_740_991_i64),
            json!(9_007_199_254_740_991_i64),
            json!(" opaque "),
        ] {
            let entity: EntityRef = serde_json::from_value(make(id.clone())).unwrap();
            assert_eq!(serde_json::to_value(entity).unwrap(), make(id));
        }
        for id in [
            Value::Null,
            json!(false),
            json!(1.5),
            json!([]),
            json!({}),
            json!(""),
            json!(9_007_199_254_740_992_i64),
            json!(-9_007_199_254_740_992_i64),
            json!(u64::MAX),
        ] {
            assert!(
                serde_json::from_value::<EntityRef>(make(id.clone())).is_err(),
                "{id}"
            );
            assert!(EntityId::try_from(id).is_err());
        }
        for kind in ["music", "album", "artist", "sheet", "lyric", "chart"] {
            let mut entity = make(json!("id"));
            entity["kind"] = json!(kind);
            assert!(serde_json::from_value::<EntityRef>(entity).is_ok());
        }
        for (key, value) in [
            ("providerId", json!("Catalog")),
            ("kind", json!("video")),
            ("platform", json!("name")),
        ] {
            let mut entity = make(json!(1));
            entity[key] = value;
            assert!(serde_json::from_value::<EntityRef>(entity).is_err());
        }
        let normalized = serde_json::from_str::<EntityRef>(
            r#"{"providerId":"org.example.catalog","kind":"music","id":1e0}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(normalized).unwrap(), make(json!(1)));
        for number in [7.0, -0.0, -9_007_199_254_740_991.0, 9_007_199_254_740_991.0] {
            let normalized: EntityRef = serde_json::from_value(make(json!(number))).unwrap();
            assert_eq!(
                serde_json::to_value(normalized).unwrap(),
                make(json!(number as i64))
            );
        }
    }
}
