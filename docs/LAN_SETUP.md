# LAN Multi-Device Setup Guide
**Barangay 179 Crime BI — 2 Devices, 1 Router, 1 Shared Database**

---

## Overview

```
[Router / WiFi]
   ├── Device A (Server PC)   — MySQL 8.0 + Electron app  ← database lives here
   └── Device B (Client Laptop) — Electron app only, connects to Device A's MySQL
```

- **Device A** owns the database. Both devices read and write to it.
- **Device B** runs the same Electron app but points its DB connection to Device A's IP.
- Both devices can log in as Deputy Officer, Kagawad, or Team Leader.

---

## ONE-TIME SETUP (do once, not every session)

### DEVICE A — Server PC

#### Step 1: Allow Remote MySQL Connections
Open **MySQL Workbench** → connect to Local instance → run these 3 queries:

```sql
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY 'your_mysql_password';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
```

Verify it worked:
```sql
SELECT user, host FROM mysql.user WHERE user = 'root';
```
You should see two rows: `root | localhost` and `root | %`.

#### Step 2: Open Firewall Ports
Open **Command Prompt as Administrator** and run both commands:

```
netsh advfirewall firewall add rule name="Capstone Port 3000" dir=in action=allow protocol=TCP localport=3000
```
```
netsh advfirewall firewall add rule name="MySQL Port 3306" dir=in action=allow protocol=TCP localport=3306
```

Only needs to be done once.

#### Step 3: Find Device A's LAN IP
Open Command Prompt and run:
```
ipconfig
```
Look for **IPv4 Address** under your Wi-Fi adapter:
```
IPv4 Address . . . . . . . . . : 192.168.x.x   ← write this down
```
Give this IP to Device B.

---

### DEVICE B — Client Laptop

#### Step 1: Copy the .env file
Open **Command Prompt** on the laptop and run:
```
cd "C:\Users\Kurt\Desktop\Barangay repo 2\Barangay updated repo\Capstone-Final\backend"
copy .env.migrated .env
```
If asked "Overwrite?" → type `yes` and press Enter.

#### Step 2: Set DB Connection to Device A
Open the Electron app on the laptop → go to **Settings → Database tab** → fill in:

| Field    | Value                        |
|----------|------------------------------|
| Host     | `192.168.x.x` (Device A IP) |
| Port     | `3306`                       |
| Username | `root`                       |
| Password | `your_mysql_password`        |
| Database | `brgydata`                   |

Click **Test Connection** → should say success.
Click **Save** → app restarts with the new connection.

---

## DAILY STARTUP PROCEDURE

### DEVICE A — Start First

1. Make sure **MySQL80** Windows service is running:
   - Press `Win + R` → type `services.msc` → Enter
   - Find **MySQL80** → Status must be **Running**
   - If not → right-click → **Start**

2. Open the Electron app:
   ```
   npm start
   ```
   from the project folder. Wait for:
   ```
   ✅ Database connected successfully!
   🚀 Server running on http://localhost:3000
   ```

3. Log in as your role (Deputy Officer, Kagawad, or Team Leader).

> ⚠️ **Keep the Electron app open** the entire session — it runs the server. Closing it disconnects Device B.

---

### DEVICE B — Start After Device A is Running

1. Make sure you are on the **same WiFi/router** as Device A.

2. Open the Electron app:
   ```
   npm start
   ```
   from the project folder.

3. Log in as your role. You will see the same data as Device A.

---

## CHECKLIST BEFORE EVERY SESSION

| # | Check | Device |
|---|---|---|
| 1 | Both devices connected to same WiFi/router | Both |
| 2 | MySQL80 service is **Running** | Device A |
| 3 | Electron app is open and shows `Database connected` | Device A |
| 4 | Device A's Electron app is open **before** starting Device B | Device A |
| 5 | Electron app on Device B opens and logs in successfully | Device B |

---

## TROUBLESHOOTING

| Problem | Fix |
|---|---|
| Device B can't connect to database | Make sure Device A's Electron app is running first. Check both devices are on same WiFi. |
| `Access denied for user 'root'` on Device B | Re-do the MySQL grant steps on Device A (Step 1 of one-time setup). |
| Port 3000 already in use | Open Task Manager → find `node` process → End Task. Or run: `netstat -ano \| findstr :3000` then `taskkill /PID [pid] /F` |
| Device B shows different data than Device A | Settings → Database tab on Device B — confirm Host is Device A's IP, not `localhost`. |
| Device A IP changed | Re-run `ipconfig` on Device A. Update Device B's Settings → Database tab with the new IP. |
| MySQL80 service not starting | Open `services.msc` → find MySQL80 → right-click → Start. If it fails, restart the PC. |
| `brgydata` database missing | Open MySQL Workbench → run the schema file: File → Open SQL Script → `database/schema.sql` → Execute. |

---

## NOTES

- **All data is shared in real time** — incidents, patrols, and users added on either device appear on both within 30 seconds (auto-refresh).
- **Device A's IP may change** every time it reconnects to WiFi. If it does, update Device B's DB settings.
- **Multiple clients** — more than 2 devices can connect to Device A at the same time.
- **MySQL Workbench** does not need to stay open during the session — only the MySQL80 Windows service must be active.
- **Do not run `node server.js` manually** — the Electron app starts the server automatically.
