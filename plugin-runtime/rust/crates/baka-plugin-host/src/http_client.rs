use std::sync::{Arc, OnceLock};

pub fn http_client_builder() -> reqwest::ClientBuilder {
    static TLS: OnceLock<rustls::ClientConfig> = OnceLock::new();
    let config = TLS.get_or_init(|| {
        tls_config(rustls::RootCertStore::from_iter(
            webpki_roots::TLS_SERVER_ROOTS.iter().cloned(),
        ))
    });
    reqwest::Client::builder().use_preconfigured_tls(config.clone())
}

fn tls_config(roots: rustls::RootCertStore) -> rustls::ClientConfig {
    rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("ring supports the default TLS protocols")
        .with_root_certificates(roots)
        .with_no_client_auth()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn configured_tls_builds_without_a_platform_verifier() {
        let client = http_client_builder().no_proxy().build().unwrap();
        assert!(client.get("https://example.com").build().is_ok());
        assert!(!webpki_roots::TLS_SERVER_ROOTS.is_empty());
    }

    #[tokio::test]
    async fn certificate_and_hostname_checks_remain_enforced() {
        let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let der = certificate.cert.der().clone();
        let key =
            rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.signing_key.serialize_der());
        let server = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![der.clone()], key.into())
        .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server));
            for _ in 0..3 {
                let (socket, _) = listener.accept().await.unwrap();
                if let Ok(mut stream) = acceptor.accept(socket).await {
                    let mut request = Vec::new();
                    let mut chunk = [0; 1024];
                    while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                        let count = stream.read(&mut chunk).await.unwrap();
                        assert!(count > 0);
                        request.extend_from_slice(&chunk[..count]);
                        assert!(request.len() <= 8192);
                    }
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                        )
                        .await
                        .unwrap();
                    stream.flush().await.unwrap();
                    let _ = stream.read(&mut chunk).await;
                }
            }
        });
        let url = format!("https://localhost:{}/", address.port());
        let untrusted = http_client_builder()
            .no_proxy()
            .resolve("localhost", address)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let error = untrusted.get(&url).send().await.unwrap_err();
        assert!(format!("{error:?}").contains("UnknownIssuer"));
        let mut roots = rustls::RootCertStore::empty();
        roots.add(der).unwrap();
        let trusted = reqwest::Client::builder()
            .use_preconfigured_tls(tls_config(roots))
            .no_proxy()
            .resolve("localhost", address)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        assert_eq!(
            trusted
                .get(&url)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "ok"
        );
        let error = trusted
            .get(format!("https://{address}/"))
            .send()
            .await
            .unwrap_err();
        assert!(format!("{error:?}").contains("NotValidForName"));
        tokio::time::timeout(std::time::Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap();
    }
}
