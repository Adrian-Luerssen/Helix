# Prediction Market Agent - Cron Jobs

This document explains how to set up Clawdbot cron jobs for automated market scanning and trade resolution checking.

## Overview

Two cron scripts are available:

| Script | Purpose | Recommended Frequency |
|--------|---------|----------------------|
| `scripts/scan_markets.py` | Scan Polymarket for trading opportunities | Every 4-6 hours |
| `scripts/check_resolutions.py` | Check open trades for resolutions, calculate P&L | Every 12-24 hours |

## Setup with Clawdbot

### 1. Register the Cron Jobs

Use `clawdbot cron` to register the jobs:

```bash
# Market scanning - runs every 6 hours
clawdbot cron add "scan-markets" \
  --schedule "0 */6 * * *" \
  --command "cd /home/albert/clawd/projects/sharp/apps/prediction-market && ./venv/bin/python scripts/scan_markets.py --output-json" \
  --description "Scan Polymarket for trading opportunities"

# Resolution checking - runs daily at 6 AM
clawdbot cron add "check-resolutions" \
  --schedule "0 6 * * *" \
  --command "cd /home/albert/clawd/projects/sharp/apps/prediction-market && ./venv/bin/python scripts/check_resolutions.py --output-json" \
  --description "Check open trades for resolutions"
```

### 2. Alternative: Use Clawdbot Agent Tasks

You can also run these as agent tasks that report results:

```bash
# Via clawdbot chat command
clawdbot chat "Run the prediction market scanner and report high-value opportunities"

# Or directly
cd /home/albert/clawd/projects/sharp/apps/prediction-market
./venv/bin/python scripts/scan_markets.py --output-json --alert-threshold 0.15
```

### 3. Systemd Timer (Alternative)

If you prefer systemd timers:

```bash
# Create service file
cat > ~/.config/systemd/user/pm-scan.service << 'EOF'
[Unit]
Description=Prediction Market Scanner
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/home/albert/clawd/projects/sharp/apps/prediction-market
ExecStart=/home/albert/clawd/projects/sharp/apps/prediction-market/venv/bin/python scripts/scan_markets.py
EOF

# Create timer
cat > ~/.config/systemd/user/pm-scan.timer << 'EOF'
[Unit]
Description=Run Prediction Market Scanner every 6 hours

[Timer]
OnBootSec=15min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Enable and start
systemctl --user daemon-reload
systemctl --user enable pm-scan.timer
systemctl --user start pm-scan.timer
```

## Script Options

### scan_markets.py

```
Usage: python scripts/scan_markets.py [OPTIONS]

Options:
  --min-volume FLOAT      Minimum market volume (default: 1000)
  --alert-threshold FLOAT EV threshold for alerts (default: 0.1)
  --strategies STR        Comma-separated strategies (default: all)
  --dry-run              Don't write to files
  --output-json          Output JSON for Clawdbot processing
```

**Output Files:**
- `data/opportunities.jsonl` - All discovered opportunities
- `data/scan_log.jsonl` - Scan metadata/statistics

### check_resolutions.py

```
Usage: python scripts/check_resolutions.py [OPTIONS]

Options:
  --dry-run              Don't update database
  --output-json          Output JSON for Clawdbot processing
```

**Output Files:**
- `data/lessons_learned.jsonl` - Self-improvement insights
- `data/resolution_log.jsonl` - Resolution events

## Data Files

All data is stored in the `data/` directory:

```
data/
├── trades.db              # SQLite database (trades, markets)
├── opportunities.jsonl    # Discovered opportunities log
├── scan_log.jsonl         # Scan run metadata
├── lessons_learned.jsonl  # Self-improvement insights
└── resolution_log.jsonl   # Trade resolution events
```

## Integration with Clawdbot Alerts

To receive alerts for high-value opportunities:

1. **Via Clawdbot cron output:**
   The `--output-json` flag outputs structured JSON that Clawdbot can parse and forward to Telegram/Discord.

2. **Custom alert script:**
   ```bash
   #!/bin/bash
   # Run scan and check for high-value opps
   RESULT=$(cd /home/albert/clawd/projects/sharp/apps/prediction-market && \
     ./venv/bin/python scripts/scan_markets.py --output-json --alert-threshold 0.15)
   
   # Parse and alert if opportunities found
   HIGH_VALUE=$(echo "$RESULT" | jq '.high_value_opportunities | length')
   if [ "$HIGH_VALUE" -gt 0 ]; then
     clawdbot chat "Found $HIGH_VALUE high-value prediction market opportunities: $RESULT"
   fi
   ```

3. **HEARTBEAT.md integration:**
   Add to your `HEARTBEAT.md`:
   ```markdown
   - [ ] Check prediction market scan results in `~/clawd/projects/sharp/apps/prediction-market/data/`
   - [ ] Alert if high-value opportunities (EV > 15%) found
   ```

## Example Cron Schedule

```cron
# Prediction Market Agent - Cron Jobs
# ====================================

# Market scanning - every 6 hours
0 */6 * * * cd /home/albert/clawd/projects/sharp/apps/prediction-market && ./venv/bin/python scripts/scan_markets.py >> /home/albert/clawd/projects/sharp/apps/prediction-market/logs/scan.log 2>&1

# Resolution checking - daily at 6 AM
0 6 * * * cd /home/albert/clawd/projects/sharp/apps/prediction-market && ./venv/bin/python scripts/check_resolutions.py >> /home/albert/clawd/projects/sharp/apps/prediction-market/logs/resolution.log 2>&1
```

## Monitoring

Check cron job status:
```bash
# Clawdbot crons
clawdbot cron list

# Systemd timers
systemctl --user list-timers

# View logs
tail -f /home/albert/clawd/projects/sharp/apps/prediction-market/logs/*.log
```

## Troubleshooting

**Import errors:**
```bash
# Ensure venv is activated
cd /home/albert/clawd/projects/sharp/apps/prediction-market
source venv/bin/activate
pip install -r backend/requirements.txt
```

**Database not initialized:**
```bash
# Start the backend once to init DB
./start.sh
# Or manually:
./venv/bin/python -c "from backend.db.database import init_db; import asyncio; asyncio.run(init_db())"
```

**API rate limits:**
- The Polymarket API has rate limits. If you see 429 errors, reduce scan frequency.
- Consider adding delays between batches in `scan_markets.py`.
