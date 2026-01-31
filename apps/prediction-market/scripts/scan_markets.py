#!/usr/bin/env python3
"""
Scan Polymarket for trading opportunities.

Usage:
    python scripts/scan_markets.py [--alert-threshold 0.1] [--dry-run]
    
Designed to be run as a Clawdbot cron job.
"""

import asyncio
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.platforms import PolymarketAdapter
from backend.strategies import NothingEverHappensStrategy, YieldFarmingStrategy
from backend.config import settings


# Output paths
DATA_DIR = PROJECT_ROOT / "data"
OPPORTUNITIES_FILE = DATA_DIR / "opportunities.jsonl"
SCAN_LOG_FILE = DATA_DIR / "scan_log.jsonl"


# Strategy registry
STRATEGIES = {
    "nothing_ever_happens": NothingEverHappensStrategy,
    "yield_farming": YieldFarmingStrategy,
}


async def fetch_markets(adapter: PolymarketAdapter, min_volume: float = 1000) -> list:
    """Fetch all active markets from Polymarket."""
    print(f"[{datetime.now().isoformat()}] Fetching markets from Polymarket...")
    
    # Fetch markets in batches (API limit is typically 100)
    all_markets = []
    batch_size = 100
    
    # Fetch multiple pages
    for page in range(5):  # Up to 500 markets
        try:
            markets = await adapter.get_markets(
                limit=batch_size,
                active_only=True,
                closed=False,
            )
            
            if not markets:
                break
            
            # Filter by volume
            filtered = [m for m in markets if (m.volume or 0) >= min_volume]
            all_markets.extend(filtered)
            
            if len(markets) < batch_size:
                break  # No more results
                
        except Exception as e:
            print(f"  Error fetching batch {page}: {e}")
            break
    
    # Deduplicate by market_id
    seen = set()
    unique_markets = []
    for m in all_markets:
        if m.market_id not in seen:
            seen.add(m.market_id)
            unique_markets.append(m)
    
    print(f"  Found {len(unique_markets)} active markets with volume >= ${min_volume}")
    
    return unique_markets


async def scan_with_strategies(markets: list, strategy_names: list[str] = None) -> list:
    """Run all strategies against the fetched markets."""
    if strategy_names is None:
        strategy_names = list(STRATEGIES.keys())
    
    all_opportunities = []
    
    for name in strategy_names:
        if name not in STRATEGIES:
            print(f"  Warning: Unknown strategy '{name}', skipping")
            continue
        
        strategy = STRATEGIES[name]()
        print(f"  Scanning with {name} strategy...")
        
        opportunities = await strategy.scan_markets(markets)
        print(f"    Found {len(opportunities)} opportunities")
        
        all_opportunities.extend(opportunities)
    
    return all_opportunities


def log_opportunities(opportunities: list, dry_run: bool = False):
    """Log opportunities to JSONL file."""
    if dry_run:
        print("\n[DRY RUN] Would log the following opportunities:")
        for opp in opportunities[:5]:
            print(f"  - {opp.strategy}: {opp.market.question[:50]}... (EV: {opp.expected_value:.2%})")
        return
    
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(OPPORTUNITIES_FILE, "a") as f:
        for opp in opportunities:
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "strategy": opp.strategy,
                "market_id": opp.market.market_id,
                "platform": opp.market.platform,
                "question": opp.market.question,
                "signal_strength": opp.signal_strength,
                "recommended_side": opp.recommended_side,
                "recommended_amount": opp.recommended_amount,
                "expected_value": opp.expected_value,
                "yes_price": opp.market.yes_price,
                "no_price": opp.market.no_price,
                "volume": opp.market.volume,
                "reasoning": opp.reasoning,
            }
            f.write(json.dumps(entry) + "\n")
    
    print(f"  Logged {len(opportunities)} opportunities to {OPPORTUNITIES_FILE}")


def log_scan(scan_result: dict):
    """Log scan metadata."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(SCAN_LOG_FILE, "a") as f:
        f.write(json.dumps(scan_result) + "\n")


def get_high_value_opportunities(opportunities: list, threshold: float = 0.1) -> list:
    """Filter for high-value opportunities."""
    return [
        opp for opp in opportunities
        if opp.expected_value >= threshold or opp.signal_strength >= 0.8
    ]


def format_alert(opportunities: list) -> str:
    """Format opportunities as an alert message."""
    if not opportunities:
        return None
    
    lines = ["🎯 **Prediction Market Opportunities Found**\n"]
    
    for opp in sorted(opportunities, key=lambda x: x.expected_value, reverse=True)[:10]:
        lines.append(
            f"• **{opp.strategy}**: {opp.market.question[:60]}..."
            f"\n  └ {opp.recommended_side.upper()} @ {opp.market.yes_price if opp.recommended_side == 'yes' else opp.market.no_price:.0%}"
            f" | EV: {opp.expected_value:.1%} | Signal: {opp.signal_strength:.0%}"
        )
    
    return "\n".join(lines)


async def main():
    parser = argparse.ArgumentParser(description="Scan Polymarket for opportunities")
    parser.add_argument("--min-volume", type=float, default=1000, 
                        help="Minimum volume threshold (default: 1000)")
    parser.add_argument("--alert-threshold", type=float, default=0.1,
                        help="EV threshold for alerts (default: 0.1)")
    parser.add_argument("--strategies", type=str, default=None,
                        help="Comma-separated list of strategies to run")
    parser.add_argument("--dry-run", action="store_true",
                        help="Don't write to files, just print")
    parser.add_argument("--output-json", action="store_true",
                        help="Output results as JSON for Clawdbot")
    args = parser.parse_args()
    
    strategy_names = None
    if args.strategies:
        strategy_names = [s.strip() for s in args.strategies.split(",")]
    
    adapter = PolymarketAdapter()
    scan_start = datetime.now(timezone.utc)
    
    try:
        # Fetch markets
        markets = await fetch_markets(adapter, min_volume=args.min_volume)
        
        if not markets:
            print("No markets found. Exiting.")
            return
        
        # Run strategies
        opportunities = await scan_with_strategies(markets, strategy_names)
        
        # Log all opportunities
        log_opportunities(opportunities, dry_run=args.dry_run)
        
        # Find high-value opportunities
        high_value = get_high_value_opportunities(opportunities, args.alert_threshold)
        
        # Log scan metadata
        scan_result = {
            "timestamp": scan_start.isoformat(),
            "duration_seconds": (datetime.now(timezone.utc) - scan_start).total_seconds(),
            "markets_scanned": len(markets),
            "opportunities_found": len(opportunities),
            "high_value_count": len(high_value),
            "strategies_run": strategy_names or list(STRATEGIES.keys()),
        }
        
        if not args.dry_run:
            log_scan(scan_result)
        
        # Output for Clawdbot
        if args.output_json:
            output = {
                "scan": scan_result,
                "high_value_opportunities": [
                    {
                        "strategy": opp.strategy,
                        "question": opp.market.question,
                        "side": opp.recommended_side,
                        "ev": opp.expected_value,
                        "signal": opp.signal_strength,
                    }
                    for opp in high_value
                ]
            }
            print(json.dumps(output, indent=2))
        else:
            # Human-readable summary
            print(f"\n{'='*60}")
            print(f"SCAN COMPLETE")
            print(f"  Markets scanned: {len(markets)}")
            print(f"  Opportunities found: {len(opportunities)}")
            print(f"  High-value (EV >= {args.alert_threshold:.0%}): {len(high_value)}")
            print(f"  Duration: {scan_result['duration_seconds']:.1f}s")
            
            if high_value:
                print(f"\n{'='*60}")
                print("TOP OPPORTUNITIES:")
                alert = format_alert(high_value)
                if alert:
                    print(alert)
    
    finally:
        await adapter.close()


if __name__ == "__main__":
    asyncio.run(main())
