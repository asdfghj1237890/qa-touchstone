# Tauri 遷移 — 階段 3b-3：執行 Postman 請求（組裝，Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前面三段做好的基礎（3b-1 SigV4 簽章/憑證解析、3b-2 reqprep/STS XML 解析）組裝成 `execute_postman_request` command：環境覆寫→參數代入→組標頭→解析憑證→（必要時）STS AssumeRole→SigV4 簽章→reqwest 送出→回傳回應。加 `aws::assume_role`（async STS）、reqwest（修 bug #7 gzip 解壓），並把前端 `executePostmanRequest` 接上。這是 Phase 3 的最後一塊；**真實簽章請求成功需使用者用真實 AWS 憑證/端點實機驗證**（自動化只能驗到組裝可編譯、組成的純函式已測、SigV4 演算法已對官方向量）。

**Architecture:** 延續方案 A。後端新增 `commands/api.rs`（`execute_postman_request`），`aws.rs` 加 async `assume_role` + 公開 `sha256_hex`。HTTP 用 reqwest（gzip/deflate/brotli features → 回應自動解壓，修 bug #7）。SigV4-reqwest 整合採「最小簽章集」：只簽 `content-type`、`x-amz-content-sha256`、自訂 Postman 標頭（host/x-amz-date 由 sign() 內部加）；**不簽** reqwest 自管的 Content-Length / Connection / Accept-Encoding（避免 SignedHeaders 與實送不符 → 403）。回傳形狀逐字對齊 Electron。

**Tech Stack:** Rust（reqwest 0.12 + gzip/deflate/brotli、既有 aws/credentials/reqprep、serde_json、tauri 2）。

參照：Electron `execute-postman-request`(electron.js:2270-2618)、`assumeRole`(:17-112)。已備：`aws::sign`(3b-1)、`credentials::parse_credential_file_content`(3b-1)、`reqprep::{substitute_url,substitute_body,remove_json_comments,rebase_url,KNOWN_ENV_BASE_PATHS}`(3b-2)、`aws::parse_sts_xml`(3b-2)、`config::load_config_raw`(pub(crate))。

**逐字保留的契約：**
- 前端 `executePostmanRequest(details)` → `invoke('execute_postman_request', details)`，details 鍵：`requestDetails`/`params`/`apiConfigId`/`selectedProfile`/`selectedEnvironment`/`isFileTransferCollection`（camelCase→snake_case）。
- 成功回 `{ success:true, status, headers, body, requestMetadata:{ sentHeaders, awsService, isFileTransferCollection } }`；失敗回 `{ success:false, error }`。**永不 reject**（錯誤也 resolve 成 `{success:false,error}`）。
- service：`isFileTransferCollection` → `iotwireless`，否則 `execute-api`；region `us-east-1`；皆可被 `req.auth.awsv4` 覆寫。
- AssumeRole：僅當有憑證且 `selectedEnvironment.roleArn` 非空且憑證**無** session_token 時才做；否則沿用。

---

## File Structure

**新增（Rust）**
- `src-tauri/src/commands/api.rs` — `execute_postman_request` command + 純 helper（憑證解析、標頭組裝）

**修改（Rust）**
- `src-tauri/Cargo.toml` — 加 `reqwest`（features gzip/deflate/brotli）
- `src-tauri/src/aws.rs` — `pub fn sha256_hex`、async `pub async fn assume_role`
- `src-tauri/src/commands/mod.rs` — 加 `api`
- `src-tauri/src/lib.rs` — 註冊 `execute_postman_request`

**修改（前端）**
- `src/api/index.js` — `executePostmanRequest` 改真實 invoke
- `src/api/index.test.js` — 加測試

---

## Task 1: reqwest 相依 + `aws::assume_role`

**Files:** Modify `src-tauri/Cargo.toml`, `src-tauri/src/aws.rs`

- [ ] **Step 1: 加 reqwest（Cargo.toml `[dependencies]`）**

```toml
reqwest = { version = "0.12", features = ["gzip", "deflate", "brotli"] }
```
（保留預設 TLS：Windows 用 schannel、macOS 用 Secure Transport，無需 OpenSSL。gzip/deflate/brotli 讓回應自動解壓 → 修 bug #7。）

- [ ] **Step 2: `aws.rs` 把 `sha256_hex` 改 pub、加 `assume_role`**

把 `fn sha256_hex` 改為 `pub fn sha256_hex`。於 `parse_sts_xml` 之後加入：
```rust
/// STS AssumeRole（async）。對齊 Electron assumeRole：POST sts.amazonaws.com 表單、SigV4 簽、解析 XML。
/// 僅在傳入的 creds 無 session_token 時被呼叫（呼叫端負責判斷）。
pub async fn assume_role(creds: &Credentials, role_arn: &str, session_name: &str) -> Result<Credentials, String> {
    let body = format!(
        "Action=AssumeRole&Version=2011-06-15&RoleArn={}&RoleSessionName={}&DurationSeconds=3600",
        uri_encode(role_arn, true),
        uri_encode(session_name, true)
    );
    let mut headers = std::collections::BTreeMap::new();
    headers.insert(
        "content-type".to_string(),
        "application/x-www-form-urlencoded; charset=utf-8".to_string(),
    );
    let input = SignInput {
        method: "POST",
        host: "sts.amazonaws.com",
        path: "/",
        query: "",
        headers,
        payload: body.as_bytes(),
        service: "sts",
        region: "us-east-1",
    };
    let signed = sign(&input, creds); // Authorization / X-Amz-Date /（無 token）

    let client = reqwest::Client::new();
    let mut rb = client
        .post("https://sts.amazonaws.com/")
        .header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
        .body(body);
    for (k, v) in &signed {
        rb = rb.header(k.as_str(), v.as_str());
    }
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("STS AssumeRole failed with status {}: {}", status.as_u16(), text));
    }
    parse_sts_xml(&text).ok_or_else(|| "Failed to parse credentials from STS response".to_string())
}
```

- [ ] **Step 3: 編譯**（首次下載 reqwest，較久）

Run: `cd src-tauri && cargo build`（新 shell 先 `export PATH="$USERPROFILE/.cargo/bin:$PATH"`）
Expected: 編譯成功；既有測試不受影響（`cargo test aws` 仍 7 綠）。`assume_role` 因 async + 網路不單元測試（其 XML 解析已由 `parse_sts_xml` 測試涵蓋）。

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/aws.rs
git commit -m "feat(tauri): reqwest dep + aws::assume_role (STS, async)"
```

---

## Task 2: `commands/api.rs` — `execute_postman_request`

**Files:** Create `src-tauri/src/commands/api.rs`; Modify `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: 建立 `src-tauri/src/commands/api.rs`**

```rust
use crate::aws::{self, Credentials};
use crate::commands::config::load_config_raw;
use crate::credentials::parse_credential_file_content;
use crate::reqprep::{rebase_url, remove_json_comments, substitute_body, substitute_url, KNOWN_ENV_BASE_PATHS};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use tauri::AppHandle;

fn err(msg: impl Into<String>) -> Value {
    json!({ "success": false, "error": msg.into() })
}

/// 從 config + apiConfigId 解析出 AWS 憑證（manual 或檔案型）。純邏輯 + 讀檔。
fn resolve_credentials(
    config: &Value,
    api_config_id: &str,
    selected_profile: Option<&str>,
) -> Option<Credentials> {
    let arr = config.get("credentialsFilePaths").and_then(|a| a.as_array())?;
    let sel = arr
        .iter()
        .find(|c| c.get("id").and_then(|i| i.as_str()) == Some(api_config_id))?;
    let typ = sel.get("type").and_then(|t| t.as_str()).unwrap_or("file");
    if typ == "manual" {
        let c = sel.get("credentials")?;
        let ak = c.get("accessKeyId").and_then(|x| x.as_str()).unwrap_or("");
        let sk = c.get("secretAccessKey").and_then(|x| x.as_str()).unwrap_or("");
        if !ak.is_empty() && !sk.is_empty() {
            return Some(Credentials { access_key_id: ak.into(), secret_access_key: sk.into(), session_token: None });
        }
        return None;
    }
    let path = sel.get("path").and_then(|p| p.as_str())?;
    let content = std::fs::read_to_string(path).ok()?;
    let parsed = parse_credential_file_content(&content, path, selected_profile);
    if parsed.access_key_id.is_empty() || parsed.secret_access_key.is_empty() {
        return None;
    }
    Some(Credentials {
        access_key_id: parsed.access_key_id,
        secret_access_key: parsed.secret_access_key,
        session_token: if parsed.session_token.is_empty() { None } else { Some(parsed.session_token) },
    })
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

#[tauri::command]
pub async fn execute_postman_request(
    app: AppHandle,
    request_details: Value,
    params: Value,
    api_config_id: Option<String>,
    selected_profile: Option<String>,
    selected_environment: Option<Value>,
    is_file_transfer_collection: Option<bool>,
) -> Value {
    let req = match request_details.get("request") {
        Some(r) if r.is_object() => r.clone(),
        _ => return err("Invalid request details provided."),
    };
    let method = str_field(&req, "method").unwrap_or("GET").to_uppercase();

    // raw url（string 或 {raw}）
    let mut raw_url = match req.get("url") {
        Some(Value::String(s)) => s.clone(),
        Some(u) if u.is_object() => str_field(u, "raw").unwrap_or("").to_string(),
        _ => return err("Invalid URL format in request."),
    };
    if raw_url.is_empty() {
        return err("Invalid URL format in request.");
    }

    let env = selected_environment.as_ref().filter(|e| !e.is_null());

    // 環境覆寫（bug #8 已於 rebase_url 修正）
    if let Some(env) = env {
        let base_url = str_field(env, "baseUrl").unwrap_or("");
        let base_path = str_field(env, "basePath").unwrap_or("");
        if !base_url.is_empty() && !base_path.is_empty() {
            raw_url = rebase_url(&raw_url, base_url, base_path, KNOWN_ENV_BASE_PATHS);
        }
    }

    let params_map: Map<String, Value> = params.as_object().cloned().unwrap_or_default();
    let substituted_url = substitute_url(&raw_url, &params_map);

    let parsed = match reqwest::Url::parse(&substituted_url) {
        Ok(u) => u,
        Err(e) => return err(format!("Invalid URL: {e}")),
    };
    let host = parsed.host_str().unwrap_or("").to_string();
    let path = parsed.path().to_string();
    let query = parsed.query().unwrap_or("").to_string();

    // body（POST/PUT/PATCH + raw）
    let mut content_type = "application/json".to_string();
    let mut post_data: Option<String> = None;
    if matches!(method.as_str(), "POST" | "PUT" | "PATCH") {
        if let Some(body) = req.get("body") {
            if str_field(body, "mode") == Some("raw") {
                if let Some(raw) = str_field(body, "raw") {
                    let cleaned = remove_json_comments(raw);
                    post_data = Some(substitute_body(&cleaned, &params_map));
                }
            }
        }
    }

    // 自訂 Postman 標頭（代入後）
    let mut custom_headers: BTreeMap<String, String> = BTreeMap::new();
    if let Some(hs) = req.get("header").and_then(|h| h.as_array()) {
        for h in hs {
            if h.get("disabled").and_then(|d| d.as_bool()) == Some(true) {
                continue;
            }
            let k = substitute_url(str_field(h, "key").unwrap_or(""), &params_map);
            let v = substitute_url(str_field(h, "value").unwrap_or(""), &params_map);
            if k.eq_ignore_ascii_case("content-type") {
                content_type = v.clone();
            } else if !k.is_empty() {
                custom_headers.insert(k, v);
            }
        }
    }

    // service / region（可被 awsv4 auth 覆寫）
    let mut service = if is_file_transfer_collection == Some(true) { "iotwireless" } else { "execute-api" }.to_string();
    let mut region = "us-east-1".to_string();
    if let Some(auth) = req.get("auth") {
        if str_field(auth, "type") == Some("awsv4") {
            if let Some(arr) = auth.get("awsv4").and_then(|a| a.as_array()) {
                for kv in arr {
                    match (str_field(kv, "key"), str_field(kv, "value")) {
                        (Some("region"), Some(val)) => region = val.to_string(),
                        (Some("service"), Some(val)) => service = val.to_string(),
                        _ => {}
                    }
                }
            }
        }
    }

    // 解析憑證
    let credentials = api_config_id
        .as_deref()
        .and_then(|id| resolve_credentials(&load_config_raw(&app), id, selected_profile.as_deref()));

    // 要送出的標頭（先放預設 + 自訂）
    let mut out_headers: BTreeMap<String, String> = BTreeMap::new();
    out_headers.insert("Accept".to_string(), "*/*".to_string()); // 不簽
    out_headers.insert("Content-Type".to_string(), content_type.clone());
    for (k, v) in &custom_headers {
        out_headers.insert(k.clone(), v.clone());
    }

    // 簽章
    if let Some(creds) = credentials {
        // AssumeRole（僅在無 session_token 且有 roleArn）
        let mut final_creds = creds.clone();
        if let Some(env) = env {
            if let Some(role_arn) = str_field(env, "roleArn") {
                if !role_arn.is_empty() && creds.session_token.is_none() {
                    match aws::assume_role(&creds, role_arn, "SidewalkQAFriends").await {
                        Ok(c) => final_creds = c,
                        Err(e) => return err(format!("Failed to assume role {role_arn}: {e}")),
                    }
                }
            }
        }

        let payload = post_data.clone().unwrap_or_default();
        let content_sha = aws::sha256_hex(payload.as_bytes());

        // 最小簽章集：content-type（有 body 時）+ x-amz-content-sha256 + 自訂標頭
        let mut sign_headers: BTreeMap<String, String> = BTreeMap::new();
        if post_data.is_some() {
            sign_headers.insert("content-type".to_string(), content_type.clone());
        }
        sign_headers.insert("x-amz-content-sha256".to_string(), content_sha.clone());
        for (k, v) in &custom_headers {
            sign_headers.insert(k.to_lowercase(), v.clone());
        }

        let input = aws::SignInput {
            method: &method,
            host: &host,
            path: &path,
            query: &query,
            headers: sign_headers,
            payload: payload.as_bytes(),
            service: &service,
            region: &region,
        };
        let signed = aws::sign(&input, &final_creds); // Authorization / X-Amz-Date /（token）

        for (k, v) in signed {
            out_headers.insert(k, v);
        }
        out_headers.insert("x-amz-content-sha256".to_string(), content_sha); // 簽了就要送
    }

    // 送出（reqwest 自動加 Host/Content-Length/Accept-Encoding 並解壓 → 修 bug #7）
    let method_enum = match reqwest::Method::from_bytes(method.as_bytes()) {
        Ok(m) => m,
        Err(e) => return err(format!("Invalid method: {e}")),
    };
    let client = reqwest::Client::new();
    let mut rb = client.request(method_enum, parsed.clone());
    for (k, v) in &out_headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(body) = &post_data {
        rb = rb.body(body.clone());
    }

    let sent_headers: Map<String, Value> =
        out_headers.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();

    match rb.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let mut resp_headers = Map::new();
            for (k, v) in resp.headers().iter() {
                resp_headers.insert(k.as_str().to_string(), Value::String(v.to_str().unwrap_or("").to_string()));
            }
            let body_text = resp.text().await.unwrap_or_default();
            json!({
                "success": true,
                "status": status,
                "headers": resp_headers,
                "body": body_text,
                "requestMetadata": {
                    "sentHeaders": sent_headers,
                    "awsService": service,
                    "isFileTransferCollection": is_file_transfer_collection.unwrap_or(false)
                }
            })
        }
        Err(e) => err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_manual_credentials() {
        let config = json!({ "credentialsFilePaths": [
            { "id": "m1", "type": "manual", "credentials": { "accessKeyId": "AKIA", "secretAccessKey": "SEC" } }
        ]});
        let c = resolve_credentials(&config, "m1", None).expect("creds");
        assert_eq!(c.access_key_id, "AKIA");
        assert_eq!(c.secret_access_key, "SEC");
        assert!(c.session_token.is_none());
    }

    #[test]
    fn resolve_missing_id_is_none() {
        let config = json!({ "credentialsFilePaths": [] });
        assert!(resolve_credentials(&config, "nope", None).is_none());
    }

    #[test]
    fn resolve_manual_missing_keys_is_none() {
        let config = json!({ "credentialsFilePaths": [ { "id": "m1", "type": "manual", "credentials": {} } ]});
        assert!(resolve_credentials(&config, "m1", None).is_none());
    }
}
```

- [ ] **Step 2: `commands/mod.rs` 加 `pub mod api;`**（字母序最前）

- [ ] **Step 3: 註冊（lib.rs，於 postman 之後）**

```rust
            commands::api::execute_postman_request,
```

- [ ] **Step 4: 編譯 + 測試** — Run: `cd src-tauri && cargo test api`；Expected: 3 個 resolve_credentials 測試 PASS、`cargo build` 成功。
> `execute_postman_request` 本身因 async+網路不單元測試；組成的純函式（reqprep/aws/credentials）已各自測過，憑證解析分支以上述 3 測試涵蓋。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/api.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): execute_postman_request command (sign + reqwest send, fix bug #7)"
```

---

## Task 3: 前端 `executePostmanRequest` 接線

**Files:** Modify `src/api/index.js`, `src/api/index.test.js`

- [ ] **Step 1: 測試（index.test.js，最後一個測試後）**

```javascript
  it('executePostmanRequest 轉呼 invoke execute_postman_request 帶整個 details', async () => {
    invokeMock.mockResolvedValue({ success: true, status: 200, headers: {}, body: '{}' });
    const details = {
      requestDetails: { request: { method: 'GET', url: { raw: 'https://x/y' } } },
      params: {}, apiConfigId: null, selectedProfile: null,
      selectedEnvironment: null, isFileTransferCollection: false,
    };
    await api.executePostmanRequest(details);
    expect(invokeMock).toHaveBeenCalledWith('execute_postman_request', details);
  });
```

- [ ] **Step 2: 跑測試確認失敗** — Run: `npx vitest run src/api/index.test.js`；Expected: 新測試 FAIL（仍 NotPorted）。

- [ ] **Step 3: 實作（index.js）** — 把 `executePostmanRequest: notPorted('executePostmanRequest'),` 改為：
```javascript
  executePostmanRequest: (details) => invoke('execute_postman_request', details),
```

- [ ] **Step 4: 跑測試** — Run: `npx vitest run src/api/index.test.js`；Expected: 全 PASS。
- [ ] **Step 5: 全套件** — Run: `npx vitest run`；Expected: 無新增 failure（基準 693）。
- [ ] **Step 6: Commit**

```bash
git add src/api/index.js src/api/index.test.js
git commit -m "feat(api): wire executePostmanRequest to tauri"
```

---

## Task 4: 端到端驗證 + 收尾

**Files:** 無

- [ ] **Step 1: 後端全測試** — `cd src-tauri && cargo test`；Expected: 既有 53 + api 3 共 56 全綠。
- [ ] **Step 2: 前端全測試** — `npx vitest run`；Expected: 基準 693 + 1 = 694，無回歸。
- [ ] **Step 3: 啟動煙霧** — `npm run tauri:dev`；Expected: App 啟動、`execute_postman_request` 已註冊、無 runtime/capability 錯誤。（驗畢關閉 dev 程序樹。）
- [ ] **Step 4: 手動 + 實機驗收（需使用者真實 AWS 憑證/端點）**
  - API Test 頁選一個 Postman collection 請求、填參數、選環境、選 API 憑證設定 → 送出 → 應回 2xx 與正確 JSON（gzip 回應正常顯示，非亂碼 → bug #7）。
  - 含 roleArn 的環境 → 確認 AssumeRole 成功（用暫時憑證簽章）。
  - 若出現 403：對照記憶中的 SigV4-reqwest 要點（最小簽章集、x-amz-content-sha256 要簽要送、勿簽 Content-Length/Connection）。
  - 環境覆寫 URL：原 URL 首段非已知 base path 時不被誤刪（bug #8）。
- [ ] **Step 5: 記錄結果**（無 commit，除非修問題）

---

## 階段 3b-3 完成定義

- [ ] `execute_postman_request` 組裝完成並註冊；前端 `executePostmanRequest` 接上
- [ ] 回應經 reqwest 自動解壓（bug #7）；環境覆寫只剝已知 base path（bug #8，3b-2 已修）
- [ ] AssumeRole 在有 roleArn 且無 session_token 時觸發
- [ ] `cargo test` 綠（含憑證解析分支）、前端 vitest 無回歸、App 啟動正常
- [ ] **實機**：一筆真實簽章請求成功（使用者驗證）

---

## Self-Review 紀錄

- **Spec 覆蓋**：對齊 Electron execute-postman-request 主流程與 assumeRole；§5 phase 3 驗收「掃 collection（3a）、SigV4（3b-1）、AssumeRole、送請求顯示回應」。修 §7 bug #7（reqwest 自動解壓）；bug #8 於 3b-2 `rebase_url` 修；bug #9 不適用（OpenAPI 延後）。
- **SigV4-reqwest 整合**：最小簽章集（content-type/x-amz-content-sha256/自訂標頭 + sign 內加 host/x-amz-date/token）；不簽 reqwest 自管標頭；簽了的 x-amz-content-sha256 也送。降低真實請求 403 風險（仍須實機確認）。
- **可測 vs 不可測**：純組成（reqprep/aws/credentials）已測；憑證解析分支以 api.rs 3 測試涵蓋；`execute_postman_request`/`assume_role` 的網路送出無法本機測 → 列入實機驗收。
- **Placeholder 掃描**：無 TBD/TODO。
- **型別一致性**：command 參數 snake_case 對應前端 details 鍵；回傳 `{success,status,headers,body,requestMetadata}` 逐字對齊；`aws::sha256_hex` 改 pub 供算 x-amz-content-sha256；`load_config_raw` pub(crate) 重用。
