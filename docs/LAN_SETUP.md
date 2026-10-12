# LAN Multi-Device Setup Guide
**Barangay 179 Crime BI — 2 Devices, 1 Router, 1 Database**

---

## Overview

```
[Router / WiFi]
   ├── Device A (Server)  — runs Node.js + MySQL 8.0, any role
   └── Device B (Client)  — browser only, any role
```

Device B never installs Node.js or MySQL. It just opens a browser pointed at Device A's IP.

---

## Device A — Server Setup

### 1. Make Sure MySQL 8.0 Service is Running
MySQL Workbench 8.0 CE runs MySQL as a **Windows Service** — no XAMPP needed.

**Option A — via MySQL Workbench:**
- Open **MySQL Workbench 8.0 CE**
- Connect to **Local instance MySQL80**
- If it connects successfully, MySQL is already running

**Option B — via Windows Services (faster):**
- Press `Win + R` → type `services.msc` → Enter
- Find **MySQL80** in the list
- Status should be **Running**
- If not, right-click → **Start**

### 2. Verify the Database Exists
Open **MySQL Workbench** → connect to Local instance → run:
```sql
SHOW DATABASES;
```
Confirm `brgydata` is listed. Then check tables:
```sql
USE brgydata;
SHOW TABLES;
```
If `brgydata` is missing, run the schema file:
- File → Open SQL Script → select `database/schema.sql` → Execute (⚡)

### 3. Find Your LAN IP Address
Open **Command Prompt** and run:
```
ipconfig
```
Look for **IPv4 Address** under your **Wi-Fi adapter**:
```
IPv4 Address . . . . . . . . . : 192.168.x.x   ← this is your LAN IP
```
Write this down — Device B will need it.

### 4. Allow Port 3000 Through Windows Firewall
Open **Command Prompt as Administrator** and run:
```
netsh advfirewall firewall add rule name="Capstone Port 3000" dir=in action=allow protocol=TCP localport=3000
```
Only needs to be done once per machine.

### 5. Start the Backend Server
Open **Command Prompt** or **Terminal**, then run:
```
cd "C:\Users\[your name]\Downloads\Capstone Final\backend"
node server.js
```
You should see:
```
✅ Database connected successfully!
🚀 Server running on http://localhost:3000
```
**Keep this terminal open.** Do not close it while the app is in use.

### 6. Open the App on Device A
Open any browser on Device A:
```
http://localhost:3000
```
Log in as Administrator.

---

## Device B — Client Setup

### No installation needed.

### 1. Connect to the Same WiFi/Router as Device A

### 2. Open the Browser
Type the **LAN IP of Device A** in the address bar:
```
http://192.168.x.x:3000
```
Replace `192.168.x.x` with the actual IP you found in Step A3.

### 3. Log In
Use any staff account (Administrator, Decision-Maker, Desk Officer).
Same login credentials as usual — same database as Device A.

---

## Tanod Portal (optional)
Any device on the same network can open the Tanod Portal:
```
http://192.168.x.x:3000/tanod-login.html
```

---

## Checklist Before Starting

| # | Check | Device |
|---|---|---|
| 1 | Both devices on the same WiFi/router | Both |
| 2 | MySQL80 Windows service is **Running** | Device A |
| 3 | `brgydata` database exists with tables | Device A |
| 4 | Firewall rule for port 3000 added | Device A |
| 5 | `node server.js` is running in terminal | Device A |
| 6 | Device B browser opens `http://[Device A IP]:3000` | Device B |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Device B can't reach the server | Check both devices are on the same WiFi. Re-run the firewall command on Device A. |
| `"Database connected"` not showing | Open Services (`services.msc`) on Device A and confirm **MySQL80** is Running before starting `node server.js` |
| MySQL Workbench won't connect | Make sure the MySQL80 service is started in `services.msc` |
| Wrong IP / can't find server | Re-run `ipconfig` on Device A — IP may have changed after reconnecting to WiFi |
| Setup wizard appears on Device B | Fill in: Host `192.168.x.x` (Device A's IP), Port `3306`, User `root`, DB `brgydata` → Test → Save |
| Port 3000 already in use | Run `netstat -ano \| findstr :3000` to find the PID, then `taskkill /PID [pid] /F` |
| `Access denied for user 'root'` | Open MySQL Workbench → check the root password matches `DB_PASSWORD` in `backend/.env` |

---

## Notes

- **All data is shared** — incidents, patrols, users added on either device appear instantly on both (30-second live refresh).
- **Only Device A needs Node.js and MySQL installed.** Device B is just a browser.
- **Multiple clients supported** — more than 2 devices can connect to Device A at the same time.
- Device A's LAN IP may change each time it reconnects to WiFi. If it changes, just re-run `ipconfig` and give the new IP to Device B.
- MySQL Workbench does **not** need to stay open while the app is running — only the MySQL80 Windows service needs to be active.
