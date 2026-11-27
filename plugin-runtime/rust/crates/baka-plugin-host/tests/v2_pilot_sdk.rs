use baka_plugin_host::PluginHost;
use flate2::{Compression, write::ZlibEncoder};
use serde_json::{Value, json};
use std::io::Write;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn compressed(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}
async fn host(body: &str) -> PluginHost {
    let host = PluginHost::new_with_network("org.example.pilot-sdk", Default::default())
        .await
        .unwrap();
    host.load_v2_script(&format!("// @baka-provider 2\nmodule.exports={{manifest:{{apiVersion:2,kind:'provider',author:'Fixture',sourceId:'fixture.v1',id:'org.example.pilot-sdk',name:'SDK vectors',version:'1.0.0',capabilities:['media.resolve']}},handlers:{{media:{{resolve:async(r,sdk)=>{{{body}}}}}}}}}" )).await.unwrap();
    host
}
async fn call(host: &PluginHost, entity: Value) -> Value {
    host.call_entry("media.resolve", &[json!({"entity":entity})])
        .await
        .unwrap()
}

#[tokio::test]
async fn native_bytes_text_sm3_and_lean_globals_have_exact_vectors() {
    let h = host(
        r#"const hex=sdk.bytes.encode('\u4f60\u597d\ud83d\ude00');
      return {hex,text:sdk.bytes.decode(hex),base64:sdk.bytes.decode(hex,'base64'),
        fromBase64:sdk.bytes.encode(sdk.bytes.decode(hex,'base64'),'base64'),
        fromHex:sdk.bytes.encode('00fF80','hex'),normalizedHex:sdk.bytes.decode('00fF80','hex'),
        gb:sdk.bytes.decode('c4e3bac3','gb18030'),
        html:sdk.text.decodeHtml('&lt;A&amp;B&gt;&#x1F600;&#169;'),
        sm3:sdk.crypto.hash('sm3','616263'),
        absent:[typeof require,typeof Buffer,typeof axios,typeof process],
        platformSdk:[typeof sdk.lyrics,typeof sdk.crypto.kuwoDecryptEkey]};"#,
    )
    .await;
    let v = call(&h, json!({})).await;
    assert_eq!(v["hex"], "e4bda0e5a5bdf09f9880");
    assert_eq!(v["text"], "\u{4f60}\u{597d}\u{1f600}");
    assert_eq!(v["base64"], "5L2g5aW98J+YgA==");
    assert_eq!(v["fromBase64"], v["hex"]);
    assert_eq!(v["fromHex"], "00ff80");
    assert_eq!(v["normalizedHex"], "00ff80");
    assert_eq!(v["gb"], "\u{4f60}\u{597d}");
    assert_eq!(v["html"], "<A&B>\u{1f600}\u{a9}");
    assert_eq!(
        v["sm3"],
        "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0"
    );
    assert_eq!(
        v["absent"],
        json!(["undefined", "undefined", "undefined", "undefined"])
    );
    assert_eq!(v["platformSdk"], json!(["undefined", "undefined"]));
}

#[tokio::test]
async fn native_zlib_retains_binary_bytes_and_rejects_malformed_inputs() {
    let data = [0, 255, 65, 0, 128];
    let h = host("return sdk.bytes.decompress(r.entity.packet);").await;
    assert_eq!(
        call(&h, json!({"packet":hex::encode(compressed(&data))})).await,
        hex::encode(data)
    );
    for body in [
        "return sdk.bytes.encode('not hex','hex');",
        "return sdk.bytes.encode('!','base64');",
        "return sdk.bytes.encode('a','unsupported');",
        "return sdk.bytes.decode('zz');",
        "return sdk.bytes.decode('61','unsupported');",
        "return sdk.bytes.decompress('00ff');",
        "return sdk.bytes.decompress('','gzip');",
    ] {
        let h = host(body).await;
        assert!(
            h.call_entry("media.resolve", &[json!({"entity":{}})])
                .await
                .is_err(),
            "{body}"
        );
    }
}

#[tokio::test]
async fn native_http_binary_url_and_cancelled_timer_remain_usable() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let (release, hold) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let body_start = loop {
            let mut byte = [0u8; 1];
            socket.read_exact(&mut byte).await.unwrap();
            request.push(byte[0]);
            if request.ends_with(b"\r\n\r\n") {
                break request.len();
            }
            assert!(request.len() < 8192);
        };
        assert!(
            String::from_utf8_lossy(&request).starts_with("POST /binary?q=hello+world HTTP/1.1")
        );
        let mut body = [0u8; 4];
        socket.read_exact(&mut body).await.unwrap();
        assert_eq!(body, [0, 255, 65, 0]);
        assert_eq!(body_start, request.len());
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nContent-Type: application/octet-stream\r\n\r\n\x00\xffA\x00").await.unwrap();
        // Keep the connection alive until the native response has been verified.
        let _ = hold.await;
    });
    let h=host(r#"globalThis.cancelledFired=false;
      const token=setTimeout(()=>{globalThis.cancelledFired=true;},1);clearTimeout(token);
      await new Promise(resolve=>setTimeout(resolve,10));
      const url=new URL('/binary',r.entity.url);
      url.search=new URLSearchParams({q:'hello world'}).toString();
      const response=await sdk.http.request({url:url.href,method:'POST',bodyHex:'00ff4100',responseType:'bytes',timeoutMs:3000});
      return {cancelledFired:globalThis.cancelledFired,response,param:url.searchParams.get('q')};"#).await;
    let value = call(&h, json!({"url":url})).await;
    assert_eq!(value["cancelledFired"], false);
    assert_eq!(value["param"], "hello world");
    assert_eq!(value["response"]["status"], 200);
    assert_eq!(value["response"]["body"], "00ff4100");
    release.send(()).unwrap();
    server.await.unwrap();
}
