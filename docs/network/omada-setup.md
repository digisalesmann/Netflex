# Omada setup: ND Lodge

For the engineer setting up the Wi-Fi, with the owner. Takes about half a day. The software side is ready: this page is the on-site part.

```
Starlink router ── ONV PoE switch ──┬── EAP115 v4 (floor 1)
                                    ├── EAP115 v4 (floor 2)
                                    ├── EAP115 v4 (floor 3)
                                    └── office laptop (cable): Omada Controller + NetFlex lodge link
```

The lodge has no public internet address (Starlink shares one). That's fine: the lodge link on the laptop connects **out** to netflexhq.com, and nothing needs opening on the router.

## 1. The laptop

- Plug it into the PoE switch with a network cable. Turn its Wi-Fi off.
- Windows Settings → System → Power: **Never** sleep when plugged in. Control Panel → Power Options → "Choose what closing the lid does": **Do nothing**.
- Plug it into the surge protector.
- Install **Node.js LTS** from nodejs.org (default options).

## 2. The Omada Controller

1. Download **Omada Software Controller** for Windows (latest 5.x or 6.x) from omadanetworks.com and install it.
2. Open it, choose **start with Windows**, and finish the wizard. Create the admin account; the **owner** keeps this password.
3. Site name: **ND Lodge**, country Nigeria, time zone **Africa/Lagos**.
4. Factory-reset each EAP115 (hold the reset pin about 10 seconds until the light flashes). Then in the controller → **Devices**, **Adopt** all three and update their firmware.

## 3. Two Wi-Fi networks

Settings → Wired & Wireless Networks → WLAN:

| Name                        | Security              | Portal       | Who                                                                       |
| --------------------------- | --------------------- | ------------ | ------------------------------------------------------------------------- |
| **ND Lodge Wi-Fi**          | None (open)           | Yes (step 5) | Residents and guests                                                      |
| **ND Lodge Staff** (hidden) | WPA2, strong password | No           | Office only, and the way back in if netflexhq.com or the internet is down |

## 4. The NetFlex accounts in the controller

1. **Hotspot operator** (used to switch devices on): Hotspot Manager → Operators → Add. Name `netflex-link`, a strong password, site ND Lodge. **Don't send this password to anyone**; it's typed only into the lodge link (step 6).
2. **Open API** (used to switch devices off early and see who's online): Settings → Platform Integration → Open API → Add. Mode **Client**, role **Administrator**, site ND Lodge. Note the Client ID and Client Secret for step 6. While on this page, open the **API documentation** link and find the call that **unauthorizes a hotspot client**. NetFlex needs its exact path (send a screenshot).

## 5. The sign-in page (portal)

In the office (netflexhq.com/admin → **Network**), press **Add Omada controller**, then copy the **Omada portal address** shown under it. It looks like `https://netflexhq.com/connect/omada/…`.

In the controller: Settings → Authentication → Portal → **Create New Portal**:

- **SSID:** ND Lodge Wi-Fi
- **Authentication Type:** External Portal Server
- **Custom Portal Server:** paste the Omada portal address from the office
- **HTTPS Redirection:** on
- **Landing Page:** the original URL

Then in that portal's **Access Control → Pre-Authentication Access**, add these so people can pay before they're online:

| Type | Value                   |
| ---- | ----------------------- |
| URL  | `netflexhq.com`         |
| URL  | `checkout.paystack.com` |
| URL  | `js.paystack.co`        |
| URL  | `api.paystack.co`       |
| URL  | `paystack.com`          |

Card payments may also open the customer's bank page (3-D Secure), whose address differs by bank. If paying on the lodge Wi-Fi gets stuck there, residents can pay on mobile data, or we add their bank's address here.

## 6. The lodge link

1. In the office: Network → Omada controller → **Pair lodge link** → **download it here**. Unzip it to `C:\NetFlex\lodge-link`.
2. Open **PowerShell as Administrator** in that folder:
   ```
   node lodge-link.mjs setup
   ```
   Controller address `https://127.0.0.1:8043`. Enter the operator name and password, and the Open API ID and secret.
3. In the office, press **Make a pairing code**, then on the laptop:
   ```
   node lodge-link.mjs pair ABCD-EFGH
   node lodge-link.mjs check
   ```
   `check` should say **Controller OK** and **Server OK**.
4. Make it start with the computer:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
5. The office Network page shows the lodge link as **Online** within a minute.

## 7. Two settings to confirm on site

Omada's documentation is unclear on two points, so we test them with a real phone before launch:

1. **Time format.** Make a free 1-day code in the office, use it on a phone, then open the controller → Hotspot → **Authorized Clients**. The phone's expiry should be about **24 hours** from now. If it shows something else (e.g. 1970, or 41 days), tell NetFlex: it's one setting in `lodge-link.json` (`authTime` / `authTimeUnit`).
2. **Switching off early.** Put the unauthorize path from step 4.2 into `lodge-link.json` → `controller.paths.openApiUnauthorize` (NetFlex will give the exact line), restart the link, and check that Office → Network says **Switch off early: Yes**.

Then run the [on-site test plan](poc-test-plan.md).

## If something breaks later

| Symptom                              | Check                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Office says lodge link **Offline**   | Is the laptop on, awake and on the cable? Restart it; the link starts by itself.                                                           |
| **Controller problem**               | Open the controller on the laptop. Is it running? Did someone change the operator password?                                                |
| Phones don't get the sign-in page    | Controller → Portal is still on ND Lodge Wi-Fi; the access points show **Connected** in Devices.                                           |
| Everyone stuck when internet is down | Expected: the lodge link can't reach netflexhq.com. People already online stay online until their plan ends. Staff use **ND Lodge Staff**. |
