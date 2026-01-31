#!/usr/bin/env python3
"""
Check open trades for resolved markets and update status.

Usage:
    python scripts/check_resolutions.py [--dry-run]
    
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

from sqlalchemy import select
from backend.platforms import PolymarketAdapter
from backend.db.database import AsyncSessionLocal, init_db
from backend.models.trade import TradeDB, TradeStatus
from backend.config import settings


# Output paths
DATA_DIR = PROJECT_ROOT / "data"
LESSONS_FILE = DATA_DIR / "lessons_learned.jsonl"
RESOLUTION_LOG = DATA_DIR / "resolution_log.jsonl"


async def get_open_trades() -> list[TradeDB]:
    """Fetch all open trades from database."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TradeDB).where(TradeDB.status == TradeStatus.OPEN.value)
        )
        return list(result.scalars().all())


async def check_market_resolution(adapter: PolymarketAdapter, market_id: str) -> dict:
    """Check if a market has been resolved."""
    market = await adapter.get_market(market_id)
    if not market:
        return None
    
    return {
        "market_id": market_id,
        "resolved": market.resolved,
        "resolution_outcome": market.resolution_outcome,
        "resolution_date": market.resolution_date,
        "final_yes_price": market.yes_price,
        "final_no_price": market.no_price,
    }


def calculate_pnl(trade: TradeDB, outcome: str) -> tuple[float, float]:
    """Calculate P&L and ROI for a resolved trade."""
    # If we bet YES and outcome is YES, we win
    # If we bet NO and outcome is NO, we win
    won = (trade.side == "yes" and outcome == "yes") or \
          (trade.side == "no" and outcome == "no")
    
    if won:
        # Win: shares * $1 - amount_paid
        pnl = (trade.shares or trade.amount / trade.entry_price) - trade.amount
    else:
        # Loss: lose entire amount
        pnl = -trade.amount
    
    roi = (pnl / trade.amount) * 100 if trade.amount > 0 else 0
    return pnl, roi


def calculate_clv(trade: TradeDB, closing_price: float) -> tuple[float, bool]:
    """
    Calculate Closing Line Value.
    
    CLV = our entry price vs. the closing price
    Positive CLV means we got a better price than the market settled at.
    """
    if trade.side == "yes":
        clv = closing_price - trade.entry_price
    else:
        # For NO bets, we want a lower NO price at close
        clv = trade.entry_price - closing_price
    
    # Did we beat the closing line?
    beat_clv = clv > 0
    return clv, beat_clv


def generate_lessons(trade: TradeDB, resolution: dict, pnl: float, clv: float, beat_clv: bool) -> dict:
    """Generate lessons learned from a resolved trade."""
    won = pnl > 0
    
    lessons = {
        "trade_id": trade.id,
        "strategy": trade.strategy,
        "market_question": trade.market_question,
        "side": trade.side,
        "entry_price": trade.entry_price,
        "outcome": resolution.get("resolution_outcome"),
        "pnl": pnl,
        "clv": clv,
        "beat_clv": beat_clv,
        "insights": [],
        "action_items": [],
    }
    
    # Analyze the trade
    if won:
        lessons["insights"].append("✅ Profitable trade - strategy worked")
        if beat_clv:
            lessons["insights"].append("✅ Beat closing line - excellent entry timing")
        else:
            lessons["insights"].append("⚠️ Won but didn't beat closing line - consider waiting for better entries")
    else:
        lessons["insights"].append("❌ Loss - strategy didn't work this time")
        if beat_clv:
            lessons["insights"].append("💡 Beat closing line despite loss - entry was good, outcome unlucky")
        else:
            lessons["insights"].append("❌ Didn't beat closing line - entry timing was poor")
            lessons["action_items"].append("Review entry criteria for this strategy")
    
    # Strategy-specific insights
    if trade.strategy == "nothing_ever_happens":
        if not won:
            lessons["insights"].append("🎲 Dramatic event actually happened - rare but expected sometimes")
            lessons["action_items"].append("Check if this category should be excluded")
    
    elif trade.strategy == "yield_farming":
        if not won:
            lessons["insights"].append("😱 'Impossible' event occurred - review absurdity criteria")
            lessons["action_items"].append("Add this pattern to watchlist")
    
    # Time-based insights
    if trade.created_at and resolution.get("resolution_date"):
        try:
            res_date = datetime.fromisoformat(resolution["resolution_date"].replace("Z", "+00:00"))
            hold_days = (res_date - trade.created_at).days
            if hold_days > 30:
                lessons["insights"].append(f"📅 Long hold period ({hold_days} days) - capital was locked")
        except Exception:
            pass
    
    return lessons


async def update_trade(trade_id: str, updates: dict):
    """Update a trade in the database."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TradeDB).where(TradeDB.id == trade_id)
        )
        trade = result.scalar_one_or_none()
        if trade:
            for key, value in updates.items():
                setattr(trade, key, value)
            trade.updated_at = datetime.now(timezone.utc)
            await session.commit()
            return True
    return False


def log_lessons(lessons: dict):
    """Log lessons learned to JSONL file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(LESSONS_FILE, "a") as f:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **lessons
        }
        f.write(json.dumps(entry) + "\n")


def log_resolution(trade_id: str, resolution: dict, pnl: float, roi: float):
    """Log resolution event."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    with open(RESOLUTION_LOG, "a") as f:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "trade_id": trade_id,
            "resolution": resolution,
            "pnl": pnl,
            "roi": roi,
        }
        f.write(json.dumps(entry) + "\n")


async def main():
    parser = argparse.ArgumentParser(description="Check for resolved trades")
    parser.add_argument("--dry-run", action="store_true",
                        help="Don't update database, just print")
    parser.add_argument("--output-json", action="store_true",
                        help="Output results as JSON for Clawdbot")
    args = parser.parse_args()
    
    # Initialize database
    await init_db()
    
    print(f"[{datetime.now().isoformat()}] Checking for resolved trades...")
    
    # Get open trades
    open_trades = await get_open_trades()
    print(f"  Found {len(open_trades)} open trades")
    
    if not open_trades:
        if args.output_json:
            print(json.dumps({"status": "no_open_trades"}))
        return
    
    adapter = PolymarketAdapter()
    resolved_count = 0
    total_pnl = 0
    results = []
    
    try:
        for trade in open_trades:
            # Only check Polymarket trades for now
            if trade.platform != "polymarket":
                continue
            
            print(f"  Checking: {trade.market_question[:50]}...")
            
            resolution = await check_market_resolution(adapter, trade.market_id)
            
            if not resolution:
                print(f"    Could not fetch market data")
                continue
            
            if not resolution.get("resolved"):
                print(f"    Not yet resolved")
                continue
            
            # Market is resolved!
            resolved_count += 1
            outcome = resolution.get("resolution_outcome")
            closing_price = resolution.get("final_yes_price") if trade.side == "yes" else resolution.get("final_no_price")
            
            print(f"    RESOLVED: {outcome}")
            
            # Calculate metrics
            pnl, roi = calculate_pnl(trade, outcome)
            clv, beat_clv = calculate_clv(trade, closing_price) if closing_price else (None, None)
            
            # Determine status
            status = TradeStatus.RESOLVED_WIN if pnl > 0 else TradeStatus.RESOLVED_LOSS
            
            print(f"    P&L: ${pnl:.2f} ({roi:.1f}%)")
            if clv is not None:
                print(f"    CLV: {clv:.4f} (Beat line: {beat_clv})")
            
            # Generate lessons
            lessons = generate_lessons(trade, resolution, pnl, clv, beat_clv)
            
            results.append({
                "trade_id": trade.id,
                "question": trade.market_question,
                "outcome": outcome,
                "pnl": pnl,
                "roi": roi,
                "clv": clv,
                "beat_clv": beat_clv,
                "lessons": lessons,
            })
            
            total_pnl += pnl
            
            if not args.dry_run:
                # Update database
                updates = {
                    "status": status.value,
                    "resolution_date": datetime.now(timezone.utc),
                    "resolution_outcome": outcome,
                    "closing_price": closing_price,
                    "pnl": pnl,
                    "roi": roi,
                    "clv": clv,
                    "was_good_trade": beat_clv,
                    "lessons": json.dumps(lessons["insights"]),
                }
                await update_trade(trade.id, updates)
                
                # Log
                log_lessons(lessons)
                log_resolution(trade.id, resolution, pnl, roi)
    
    finally:
        await adapter.close()
    
    # Summary
    print(f"\n{'='*60}")
    print(f"RESOLUTION CHECK COMPLETE")
    print(f"  Open trades checked: {len(open_trades)}")
    print(f"  Newly resolved: {resolved_count}")
    print(f"  Total P&L: ${total_pnl:.2f}")
    
    if args.output_json:
        output = {
            "status": "complete",
            "open_trades_checked": len(open_trades),
            "newly_resolved": resolved_count,
            "total_pnl": total_pnl,
            "results": results,
        }
        print(json.dumps(output, indent=2))
    
    # Return high-level summary
    if resolved_count > 0:
        print("\n📊 NEWLY RESOLVED TRADES:")
        for r in results:
            emoji = "✅" if r["pnl"] > 0 else "❌"
            print(f"  {emoji} {r['question'][:50]}...")
            print(f"     P&L: ${r['pnl']:.2f} | Outcome: {r['outcome']}")
            for insight in r["lessons"]["insights"][:2]:
                print(f"     {insight}")


if __name__ == "__main__":
    asyncio.run(main())
