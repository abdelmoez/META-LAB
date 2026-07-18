# VPS hardening runbook (93.md §4.12)

Operational hardening for the production VPS. **Everything here requires VPS
administrator access and is applied by an operator — nothing in the repository
performs these steps.** Do each block in order; every block ends with a
verification command. Blocks that can lock you out carry an explicit warning —
read it *before* running the commands.

## 0. Ground rules

- Keep **two** SSH sessions open during all SSH/firewall changes: one to make
  the change, one already-authenticated session as your lifeline. Never close
  the lifeline until the verification passes in a *fresh* session.
- Know your emergency access path *before* you need it (§9).

## 1. Non-root deploy user

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/   # or install the new key (§2)
chown -R deploy:deploy /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

App/deploy ownership migration (the deploy scripts run as root today; moving
them to `deploy` + scoped sudo is the target): give `deploy` ownership of
`/opt/pecanrev` and a narrow sudoers entry for the few root-only commands:

```
# /etc/sudoers.d/pecanrev-deploy   (visudo -f !)
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx, /usr/bin/nginx -t
```

Verify: `ssh deploy@<host> sudo nginx -t` works; `ssh deploy@<host> sudo su -` prompts/denies as intended.

## 2. Ed25519 SSH keys

On each operator machine (not the server):

```bash
ssh-keygen -t ed25519 -a 100 -C "you@pecanrev-ops" -f ~/.ssh/pecanrev_ed25519
ssh-copy-id -i ~/.ssh/pecanrev_ed25519.pub deploy@<host>
```

Also generate a dedicated ed25519 keypair for GitHub Actions and store the
private key ONLY in the repo's Actions secret `VPS_SSH_KEY` (see
`secret-rotation.md`). Verify: `ssh -i ~/.ssh/pecanrev_ed25519 deploy@<host> true` succeeds.

## 3. Disable password + root SSH login

> ⚠️ **LOCKOUT RISK.** Only proceed after §2's key login is verified from a
> fresh terminal for EVERY operator (and the Actions key). Keep the lifeline
> session open.

```bash
# /etc/ssh/sshd_config.d/99-hardening.conf
cat >/etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
sshd -t && systemctl reload ssh
```

Verify from a **new** terminal: key login works; `ssh -o PubkeyAuthentication=no deploy@<host>`
is refused (no password prompt); `ssh root@<host>` is refused.

## 4. UFW firewall — default deny

> ⚠️ **LOCKOUT RISK.** `ufw allow OpenSSH` MUST come before `ufw enable`.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH        # 22
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

**The app port 3001 (and staging 3002) must NEVER be publicly reachable** —
nginx on the same host proxies to 127.0.0.1 (`deploy/nginx/`). Do not add an
allow rule for them, ever. Verify:

```bash
ufw status verbose                    # deny incoming; only 22/80/443 allowed
# From OUTSIDE the VPS:
nc -zv <host> 3001 || echo "3001 correctly unreachable"
curl -s --max-time 5 http://<host>:3001/api/health || echo "correctly blocked"
```

## 5. fail2ban (sshd jail)

```bash
apt-get install -y fail2ban
cat >/etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
```

Verify: `fail2ban-client status sshd` shows the jail active (banned-count grows
within hours on any public VPS).

## 6. Unattended security updates

```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades       # answer Yes
```

Verify: `systemctl status unattended-upgrades` active;
`unattended-upgrade --dry-run --debug 2>&1 | tail -5` runs clean. Note: kernel
updates still need a reboot — schedule one when `/var/run/reboot-required`
exists (`pm2 startup` + `pm2 save` make the app survive it, see
`pm2-operations.md`).

## 7. Log rotation

- **PM2 logs**: `pm2 install pm2-logrotate` (settings in `pm2-operations.md`).
- **nginx**: the distro ships `/etc/logrotate.d/nginx` (daily, 14 rotations) —
  verify it exists; adjust retention if disk-pressured.
- **App/backup logs** under `/var/log/pecanrev-*.log`: add a logrotate stanza:

```
# /etc/logrotate.d/pecanrev
/var/log/pecanrev-*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
}
```

Verify: `logrotate --debug /etc/logrotate.d/pecanrev` parses without errors.

## 8. Disk monitoring

A full disk takes down SQLite writes, uploads, logs, and deploys at once.

```bash
df -h /                          # manual check — keep < 80%
du -sh /opt/pecanrev/releases /opt/pecanrev/shared/storage ~/.pm2/logs /backups
```

Automate: a 5-line cron alert is fine until a real monitor exists —

```cron
0 * * * * root use=$(df -P / | awk 'NR==2{print +$5}'); [ "$use" -ge 85 ] && echo "DISK ${use}% on pecanrev VPS" | mail -s "disk alert" team@example.com
```

External uptime providers can also watch disk via a push heartbeat — see
`uptime-monitoring.md`. The deploy script independently refuses to deploy with
< 2 GB free.

## 9. Backup encryption + emergency access

- **Backup encryption**: any backup leaving the VPS is encrypted first, e.g.
  `age -r <recipient-key> prod-2026-07-18.db > prod-2026-07-18.db.age` (or GPG).
  Keys live in the team password manager, never on the VPS itself.
  Full-disk encryption on an already-running VPS is **not** retrofittable
  safely — 93.md explicitly defers it; note it for the next server rebuild.
- **Emergency access**: keep the hosting provider's out-of-band console (IONOS
  VNC/rescue mode) credentials in the password manager — it is the recovery
  path if SSH hardening ever locks everyone out. Test logging into the
  provider console once *now*. Provider-account MFA is on the launch checklist
  (external).

## 10. Verification sweep (run after completing all blocks)

```bash
ssh deploy@<host> true                          # key login, non-root
ssh root@<host> ; ssh -o PubkeyAuthentication=no deploy@<host>   # both refused
ufw status verbose                              # default-deny, 22/80/443 only
fail2ban-client status sshd                     # jail active
systemctl status unattended-upgrades            # active
pm2 status ; curl -s http://127.0.0.1:3001/api/health/ready      # app healthy
df -h /                                         # disk headroom
ls -l /opt/pecanrev/shared/server.env           # -rw------- (600)
```
