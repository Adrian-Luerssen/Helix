"""Self-improvement analyzer for the prediction market agent.

This module analyzes trades after resolution to learn from successes and failures,
with CLV (Closing Line Value) as the primary success metric.

CLV Philosophy:
- Winning/losing individual trades is noise (luck)
- Consistently beating the closing line is signal (edge)
- A +CLV trade that loses is still a good trade
- A -CLV trade that wins is still a bad trade
"""

from datetime import datetime, timedelta
from typing import Optional
from statistics import mean, stdev
from collections import defaultdict
import math

from ..models.trade import Trade, TradeStatus, TradeSide
from ..models.performance import (
    TradeAnalysis,
    StrategyPerformance,
    CalibrationPoint,
    OverallPerformance,
)


class ResolutionAnalyzer:
    """Analyzes trades after market resolution.
    
    Focuses on understanding what worked and what didn't,
    generating actionable lessons for each trade.
    """
    
    def __init__(self, trades: list[Trade] = None):
        """Initialize with optional list of trades."""
        self.trades = trades or []
    
    def analyze_resolved_trade(self, trade: Trade) -> TradeAnalysis:
        """Analyze a single resolved trade, generating lessons learned.
        
        Args:
            trade: A resolved trade to analyze
            
        Returns:
            TradeAnalysis with detailed breakdown and lessons
        """
        if trade.status not in (TradeStatus.RESOLVED_WIN, TradeStatus.RESOLVED_LOSS):
            raise ValueError(f"Trade {trade.id} is not resolved")
        
        won = trade.status == TradeStatus.RESOLVED_WIN
        pnl = trade.pnl or self._calculate_pnl(trade, won)
        roi = (pnl / trade.amount) * 100 if trade.amount > 0 else 0
        
        # CLV analysis - the most important metric
        clv = self._calculate_clv(trade)
        beat_closing_line = clv > 0 if clv is not None else None
        
        # Quality assessments
        was_good_entry = self._assess_entry_quality(trade, clv)
        was_good_sizing = self._assess_sizing_quality(trade)
        
        # Generate lessons
        what_went_right = self._identify_positives(trade, won, clv)
        what_went_wrong = self._identify_negatives(trade, won, clv)
        suggested_improvements = self._suggest_trade_improvements(
            trade, won, clv, what_went_wrong
        )
        
        return TradeAnalysis(
            trade_id=trade.id,
            strategy=trade.strategy,
            won=won,
            pnl=pnl,
            roi=roi,
            entry_price=trade.entry_price,
            closing_price=trade.closing_price,
            clv=clv,
            beat_closing_line=beat_closing_line,
            was_good_entry=was_good_entry,
            was_good_sizing=was_good_sizing,
            what_went_right=what_went_right,
            what_went_wrong=what_went_wrong,
            suggested_improvements=suggested_improvements,
        )
    
    def _calculate_pnl(self, trade: Trade, won: bool) -> float:
        """Calculate P&L for a trade."""
        if won:
            # Won: got $1 per share, minus what we paid
            shares = trade.amount / trade.entry_price
            return shares * (1 - trade.entry_price)
        else:
            # Lost: lost what we paid
            return -trade.amount
    
    def _calculate_clv(self, trade: Trade) -> Optional[float]:
        """Calculate Closing Line Value.
        
        CLV = (Closing Price - Entry Price) / Entry Price * 100
        
        For YES side: positive CLV means we got value
        For NO side: we flip the calculation (bought NO = sold YES)
        
        Returns:
            CLV as a percentage, or None if no closing price
        """
        if trade.closing_price is None:
            return None
        
        if trade.side == TradeSide.YES or trade.side == "yes":
            # Bought YES: value if closing price > entry price
            clv = ((trade.closing_price - trade.entry_price) / trade.entry_price) * 100
        else:
            # Bought NO at entry_price = sold YES at (1 - entry_price)
            # Value if closing YES price < our implied YES price
            our_implied_yes = 1 - trade.entry_price
            clv = ((our_implied_yes - trade.closing_price) / (1 - trade.entry_price)) * 100
        
        return round(clv, 2)
    
    def _assess_entry_quality(self, trade: Trade, clv: Optional[float]) -> bool:
        """Assess if the entry was good based on CLV."""
        if clv is None:
            # Without CLV, fall back to checking implied probability vs outcome
            return True  # Benefit of the doubt
        return clv > 0
    
    def _assess_sizing_quality(self, trade: Trade) -> bool:
        """Assess if position sizing was appropriate.
        
        Uses a simplified Kelly criterion check.
        """
        # Check if amount is within reasonable bounds
        # This is a placeholder - real implementation would check
        # against bankroll and Kelly fraction
        
        # For now, flag oversized positions (> $50 on single trade)
        if trade.amount > 50:
            return False
        
        # Flag very small positions that aren't worth the effort
        if trade.amount < 1:
            return False
        
        return True
    
    def _identify_positives(
        self, trade: Trade, won: bool, clv: Optional[float]
    ) -> list[str]:
        """Identify what went right in this trade."""
        positives = []
        
        # CLV-based positives (most important)
        if clv is not None and clv > 0:
            positives.append(f"Positive CLV of {clv:.1f}% - beat the closing line")
            if clv > 10:
                positives.append("Exceptional edge identified (>10% CLV)")
        
        # Outcome-based positives
        if won:
            positives.append("Trade resolved in our favor")
            if trade.entry_price < 0.3:
                positives.append("Correctly identified underpriced longshot")
            elif trade.entry_price > 0.7:
                positives.append("Correctly faded overpriced favorite")
        
        # Strategy-specific positives
        if trade.strategy == "contrarian" and clv and clv > 0:
            positives.append("Contrarian view validated - market was wrong")
        
        if trade.strategy == "momentum" and won:
            positives.append("Momentum strategy captured directional move")
        
        # Timing positives
        if trade.closing_price is not None:
            price_move = abs(trade.closing_price - trade.entry_price)
            if price_move > 0.1:
                positives.append(f"Good timing - price moved {price_move:.0%} after entry")
        
        if not positives:
            positives.append("No clear positives identified - review needed")
        
        return positives
    
    def _identify_negatives(
        self, trade: Trade, won: bool, clv: Optional[float]
    ) -> list[str]:
        """Identify what went wrong in this trade."""
        negatives = []
        
        # CLV-based negatives (most important)
        if clv is not None and clv < 0:
            negatives.append(f"Negative CLV of {clv:.1f}% - entered at worse price than close")
            if clv < -10:
                negatives.append("Severely mispriced entry (>10% worse than close)")
        
        # Outcome-based negatives
        if not won:
            negatives.append("Trade resolved against us")
            if trade.entry_price > 0.7:
                negatives.append("Lost on high-probability position - consider hedging")
            elif trade.entry_price < 0.3:
                negatives.append("Longshot didn't hit - expected but painful")
        
        # Negative CLV but won (bad process, good luck)
        if clv is not None and clv < 0 and won:
            negatives.append("Won despite negative CLV - got lucky, don't repeat this entry")
        
        # Sizing issues
        if trade.amount > 50:
            negatives.append(f"Position size ${trade.amount:.0f} may be too large")
        
        # Category-specific issues
        if trade.market_category in ["politics", "crypto"]:
            if clv is not None and clv < -5:
                negatives.append(f"Underperformed in {trade.market_category} - high volatility category")
        
        return negatives
    
    def _suggest_trade_improvements(
        self,
        trade: Trade,
        won: bool,
        clv: Optional[float],
        negatives: list[str],
    ) -> list[str]:
        """Generate specific improvement suggestions for this trade."""
        suggestions = []
        
        # CLV-based suggestions
        if clv is not None:
            if clv < -5:
                suggestions.append("Wait for better entry price - consider limit orders")
                suggestions.append("Check if news/info was already priced in before entering")
            if clv < -10:
                suggestions.append("Review information sources - market knew something we didn't")
        
        # Entry price suggestions
        if trade.entry_price > 0.85:
            suggestions.append("High entry prices leave little room for profit - require higher edge")
        if trade.entry_price < 0.15:
            suggestions.append("Low entry prices are often longshots - ensure sufficient edge")
        
        # Strategy suggestions
        if trade.strategy == "momentum" and clv and clv < 0:
            suggestions.append("Momentum entry may have been too late - price already moved")
        
        if trade.strategy == "contrarian" and not won and clv and clv < 0:
            suggestions.append("Contrarian view may have been wrong - review thesis")
            suggestions.append("Consider: was this truly contrarian or just wrong?")
        
        # Sizing suggestions
        if trade.amount > 30 and not won:
            suggestions.append("Consider smaller position sizes for uncertain bets")
        
        # Timing suggestions
        if trade.market_end_date:
            time_to_expiry = trade.market_end_date - trade.created_at
            if time_to_expiry.days > 30 and clv and clv < 0:
                suggestions.append("Long-dated markets: consider scaling in over time")
        
        if not suggestions:
            suggestions.append("Continue current approach - this was a reasonable trade")
        
        return suggestions
    
    def generate_lesson_summary(self, trade: Trade) -> str:
        """Generate a human-readable lesson summary for a trade."""
        analysis = self.analyze_resolved_trade(trade)
        
        outcome = "✅ Won" if analysis.won else "❌ Lost"
        clv_str = f"{analysis.clv:+.1f}%" if analysis.clv else "N/A"
        quality = "🎯 Good entry" if analysis.was_good_entry else "⚠️ Poor entry"
        
        lines = [
            f"Trade {trade.id[:8]}... | {outcome} | CLV: {clv_str} | {quality}",
            f"Strategy: {trade.strategy} | Entry: {trade.entry_price:.0%} | PnL: ${analysis.pnl:+.2f}",
            "",
            "What went right:" if analysis.what_went_right else "",
        ]
        
        for item in analysis.what_went_right:
            lines.append(f"  + {item}")
        
        if analysis.what_went_wrong:
            lines.append("\nWhat went wrong:")
            for item in analysis.what_went_wrong:
                lines.append(f"  - {item}")
        
        if analysis.suggested_improvements:
            lines.append("\nLessons:")
            for item in analysis.suggested_improvements:
                lines.append(f"  → {item}")
        
        return "\n".join(lines)


class StrategyEvaluator:
    """Evaluates strategy performance over time.
    
    Tracks how each strategy performs and suggests adjustments.
    """
    
    def __init__(self, trades: list[Trade] = None):
        """Initialize with trades."""
        self.trades = trades or []
        self.resolution_analyzer = ResolutionAnalyzer()
    
    def evaluate_strategy(
        self,
        strategy_name: str,
        period: str = "all_time",
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> StrategyPerformance:
        """Evaluate a strategy's performance over a period.
        
        Args:
            strategy_name: Name of strategy to evaluate
            period: One of 'daily', 'weekly', 'monthly', 'all_time'
            start_date: Optional explicit start date
            end_date: Optional explicit end date
            
        Returns:
            StrategyPerformance with metrics and suggestions
        """
        # Determine date range
        if end_date is None:
            end_date = datetime.utcnow()
        
        if start_date is None:
            start_date = self._get_period_start(period, end_date)
        
        # Filter trades
        strategy_trades = [
            t for t in self.trades
            if t.strategy == strategy_name
            and t.created_at >= start_date
            and t.created_at <= end_date
        ]
        
        if not strategy_trades:
            return StrategyPerformance(
                strategy=strategy_name,
                period=period,
                start_date=start_date,
                end_date=end_date,
            )
        
        # Calculate metrics
        resolved = [
            t for t in strategy_trades
            if t.status in (TradeStatus.RESOLVED_WIN, TradeStatus.RESOLVED_LOSS)
        ]
        wins = [t for t in resolved if t.status == TradeStatus.RESOLVED_WIN]
        losses = [t for t in resolved if t.status == TradeStatus.RESOLVED_LOSS]
        
        total_wagered = sum(t.amount for t in strategy_trades)
        total_pnl = sum(t.pnl or 0 for t in resolved)
        
        # CLV metrics
        clv_values = [t.clv for t in resolved if t.clv is not None]
        avg_clv = mean(clv_values) if clv_values else 0
        clv_positive = [c for c in clv_values if c > 0]
        
        # By category
        by_category = self._group_by_field(resolved, "market_category")
        by_platform = self._group_by_field(resolved, "platform")
        
        return StrategyPerformance(
            strategy=strategy_name,
            period=period,
            start_date=start_date,
            end_date=end_date,
            total_trades=len(strategy_trades),
            open_trades=len([t for t in strategy_trades if t.status == TradeStatus.OPEN]),
            resolved_trades=len(resolved),
            wins=len(wins),
            losses=len(losses),
            win_rate=len(wins) / len(resolved) if resolved else 0,
            total_wagered=total_wagered,
            total_pnl=total_pnl,
            roi=(total_pnl / total_wagered * 100) if total_wagered > 0 else 0,
            avg_clv=avg_clv,
            clv_positive_count=len(clv_positive),
            clv_positive_rate=len(clv_positive) / len(clv_values) if clv_values else 0,
            max_drawdown=self._calculate_max_drawdown(resolved),
            sharpe_ratio=self._calculate_sharpe(resolved),
            by_category=by_category,
            by_platform=by_platform,
        )
    
    def compare_strategies(
        self,
        period: str = "all_time",
    ) -> dict[str, StrategyPerformance]:
        """Compare all strategies over a period."""
        strategies = set(t.strategy for t in self.trades)
        return {
            strategy: self.evaluate_strategy(strategy, period)
            for strategy in strategies
        }
    
    def get_strategy_suggestions(
        self, performance: StrategyPerformance
    ) -> list[str]:
        """Generate suggestions for improving a strategy."""
        suggestions = []
        
        # Sample size warning
        if performance.resolved_trades < 10:
            suggestions.append(
                f"Only {performance.resolved_trades} resolved trades - need more data for reliable analysis"
            )
            return suggestions
        
        # CLV-based suggestions (primary metric)
        if performance.avg_clv < 0:
            suggestions.append(
                f"Negative average CLV ({performance.avg_clv:.1f}%) - review entry criteria"
            )
            if performance.avg_clv < -5:
                suggestions.append("Consider pausing this strategy until edge is re-established")
        elif performance.avg_clv > 5:
            suggestions.append(
                f"Strong CLV ({performance.avg_clv:.1f}%) - consider increasing position sizes"
            )
        
        # CLV positive rate
        if performance.clv_positive_rate < 0.4:
            suggestions.append(
                f"Only {performance.clv_positive_rate:.0%} of trades beat closing line - entry timing needs work"
            )
        elif performance.clv_positive_rate > 0.6:
            suggestions.append(
                f"Excellent CLV rate ({performance.clv_positive_rate:.0%}) - strategy has consistent edge"
            )
        
        # Win rate vs expected
        if performance.win_rate < 0.3 and performance.avg_clv > 0:
            suggestions.append("Low win rate despite positive CLV - variance or small sample size")
        if performance.win_rate > 0.7 and performance.avg_clv < 0:
            suggestions.append("High win rate with negative CLV - getting lucky, adjust entries")
        
        # ROI suggestions
        if performance.roi < -10:
            suggestions.append(f"Significant losses ({performance.roi:.1f}% ROI) - reduce exposure")
        elif performance.roi > 20:
            suggestions.append(f"Strong returns ({performance.roi:.1f}% ROI) - maintain current approach")
        
        # Category performance
        if performance.by_category:
            worst_cat = min(
                performance.by_category.items(),
                key=lambda x: x[1].get("roi", 0),
                default=(None, {})
            )
            if worst_cat[0] and worst_cat[1].get("roi", 0) < -20:
                suggestions.append(
                    f"Underperforming in {worst_cat[0]} ({worst_cat[1]['roi']:.0f}% ROI) - "
                    "consider avoiding this category"
                )
        
        if not suggestions:
            suggestions.append("Strategy performing within expectations - continue monitoring")
        
        return suggestions
    
    def _get_period_start(self, period: str, end_date: datetime) -> datetime:
        """Get start date based on period."""
        if period == "daily":
            return end_date - timedelta(days=1)
        elif period == "weekly":
            return end_date - timedelta(weeks=1)
        elif period == "monthly":
            return end_date - timedelta(days=30)
        else:  # all_time
            return datetime(2020, 1, 1)  # Far back enough
    
    def _group_by_field(
        self, trades: list[Trade], field: str
    ) -> dict[str, dict]:
        """Group trade metrics by a field."""
        groups = defaultdict(list)
        for trade in trades:
            value = getattr(trade, field, None) or "unknown"
            groups[value].append(trade)
        
        result = {}
        for group_name, group_trades in groups.items():
            wins = len([t for t in group_trades if t.status == TradeStatus.RESOLVED_WIN])
            total_pnl = sum(t.pnl or 0 for t in group_trades)
            total_wagered = sum(t.amount for t in group_trades)
            clv_values = [t.clv for t in group_trades if t.clv is not None]
            
            result[group_name] = {
                "trades": len(group_trades),
                "wins": wins,
                "win_rate": wins / len(group_trades) if group_trades else 0,
                "pnl": total_pnl,
                "wagered": total_wagered,
                "roi": (total_pnl / total_wagered * 100) if total_wagered > 0 else 0,
                "avg_clv": mean(clv_values) if clv_values else 0,
            }
        
        return result
    
    def _calculate_max_drawdown(self, trades: list[Trade]) -> float:
        """Calculate maximum drawdown from a series of trades."""
        if not trades:
            return 0
        
        # Sort by resolution date
        sorted_trades = sorted(
            trades,
            key=lambda t: t.resolution_date or t.created_at
        )
        
        cumulative_pnl = 0
        peak = 0
        max_dd = 0
        
        for trade in sorted_trades:
            cumulative_pnl += trade.pnl or 0
            if cumulative_pnl > peak:
                peak = cumulative_pnl
            drawdown = peak - cumulative_pnl
            if drawdown > max_dd:
                max_dd = drawdown
        
        return max_dd
    
    def _calculate_sharpe(self, trades: list[Trade]) -> Optional[float]:
        """Calculate Sharpe ratio from trades."""
        if len(trades) < 2:
            return None
        
        returns = [t.pnl or 0 for t in trades]
        avg_return = mean(returns)
        std_return = stdev(returns)
        
        if std_return == 0:
            return None
        
        # Annualize (assuming ~250 trading days)
        # Simplified: just return risk-adjusted return
        return round(avg_return / std_return, 2)


class ParameterTuner:
    """Suggests parameter adjustments based on historical results.
    
    Analyzes patterns in successful vs unsuccessful trades
    to recommend parameter changes.
    """
    
    def __init__(self, trades: list[Trade] = None):
        """Initialize with trades."""
        self.trades = trades or []
        self.strategy_evaluator = StrategyEvaluator(trades)
    
    def suggest_improvements(self) -> list[str]:
        """Analyze all data and suggest actionable improvements.
        
        Returns:
            List of specific, actionable improvement suggestions
        """
        improvements = []
        
        if len(self.trades) < 5:
            improvements.append("Need more trades for meaningful analysis (minimum 5)")
            return improvements
        
        resolved = [
            t for t in self.trades
            if t.status in (TradeStatus.RESOLVED_WIN, TradeStatus.RESOLVED_LOSS)
        ]
        
        if not resolved:
            improvements.append("No resolved trades yet - analysis pending")
            return improvements
        
        # 1. Entry price analysis
        improvements.extend(self._analyze_entry_prices(resolved))
        
        # 2. Strategy performance
        improvements.extend(self._analyze_strategy_allocation(resolved))
        
        # 3. Position sizing
        improvements.extend(self._analyze_position_sizing(resolved))
        
        # 4. Timing analysis
        improvements.extend(self._analyze_timing(resolved))
        
        # 5. Category performance
        improvements.extend(self._analyze_categories(resolved))
        
        # 6. CLV patterns
        improvements.extend(self._analyze_clv_patterns(resolved))
        
        return improvements if improvements else ["No specific improvements identified - maintain current approach"]
    
    def calculate_calibration(self, trades: list[Trade] = None) -> list[CalibrationPoint]:
        """Calculate calibration curve data.
        
        Compares what we paid (implied probability) vs actual outcomes.
        
        Args:
            trades: Trades to analyze (uses self.trades if None)
            
        Returns:
            List of CalibrationPoints for each price bucket
        """
        trades = trades or self.trades
        resolved = [
            t for t in trades
            if t.status in (TradeStatus.RESOLVED_WIN, TradeStatus.RESOLVED_LOSS)
        ]
        
        # Define buckets
        buckets = [
            (0.00, 0.10),
            (0.10, 0.20),
            (0.20, 0.30),
            (0.30, 0.40),
            (0.40, 0.50),
            (0.50, 0.60),
            (0.60, 0.70),
            (0.70, 0.80),
            (0.80, 0.90),
            (0.90, 1.00),
        ]
        
        calibration_points = []
        
        for bucket_start, bucket_end in buckets:
            bucket_trades = [
                t for t in resolved
                if bucket_start <= t.entry_price < bucket_end
            ]
            
            if not bucket_trades:
                continue
            
            wins = [t for t in bucket_trades if t.status == TradeStatus.RESOLVED_WIN]
            avg_entry = mean(t.entry_price for t in bucket_trades)
            actual_win_rate = len(wins) / len(bucket_trades) if bucket_trades else 0
            calibration_error = actual_win_rate - avg_entry
            
            calibration_points.append(CalibrationPoint(
                price_bucket=f"{bucket_start:.2f}-{bucket_end:.2f}",
                bucket_start=bucket_start,
                bucket_end=bucket_end,
                total_trades=len(bucket_trades),
                resolved_trades=len(bucket_trades),
                avg_entry_price=avg_entry,
                actual_win_rate=actual_win_rate,
                calibration_error=calibration_error,
                is_overpriced=calibration_error < -0.05,  # Paid too much
                is_underpriced=calibration_error > 0.05,  # Got value
            ))
        
        return calibration_points
    
    def get_optimal_parameters(self) -> dict:
        """Calculate optimal parameters based on historical performance.
        
        Returns dict with suggested parameter values.
        """
        resolved = [
            t for t in self.trades
            if t.status in (TradeStatus.RESOLVED_WIN, TradeStatus.RESOLVED_LOSS)
        ]
        
        if len(resolved) < 10:
            return {"status": "insufficient_data", "min_required": 10}
        
        # Find optimal entry price ranges
        calibration = self.calculate_calibration(resolved)
        best_buckets = [
            c for c in calibration
            if c.is_underpriced and c.total_trades >= 3
        ]
        
        # Analyze position sizing
        positive_clv_trades = [t for t in resolved if t.clv and t.clv > 0]
        negative_clv_trades = [t for t in resolved if t.clv and t.clv < 0]
        
        avg_size_winners = mean(t.amount for t in positive_clv_trades) if positive_clv_trades else 10
        avg_size_losers = mean(t.amount for t in negative_clv_trades) if negative_clv_trades else 10
        
        # Strategy allocation
        strategy_performance = self.strategy_evaluator.compare_strategies()
        best_strategy = max(
            strategy_performance.items(),
            key=lambda x: x[1].avg_clv,
            default=(None, None)
        )
        
        return {
            "status": "calculated",
            "sample_size": len(resolved),
            "entry_prices": {
                "best_buckets": [c.price_bucket for c in best_buckets],
                "avoid_buckets": [
                    c.price_bucket for c in calibration
                    if c.is_overpriced and c.total_trades >= 3
                ],
            },
            "position_sizing": {
                "recommended_base": round(min(avg_size_winners, 20), 2),
                "max_position": round(min(avg_size_winners * 2, 50), 2),
                "note": "Winners averaged larger sizes" if avg_size_winners > avg_size_losers else "Consider smaller sizes",
            },
            "strategy_allocation": {
                "best_performing": best_strategy[0] if best_strategy[0] else "unknown",
                "best_clv": round(best_strategy[1].avg_clv, 2) if best_strategy[1] else 0,
            },
        }
    
    def _analyze_entry_prices(self, trades: list[Trade]) -> list[str]:
        """Analyze entry price patterns."""
        suggestions = []
        calibration = self.calculate_calibration(trades)
        
        # Find consistently overpriced buckets
        overpriced = [c for c in calibration if c.is_overpriced and c.total_trades >= 3]
        if overpriced:
            buckets = ", ".join(c.price_bucket for c in overpriced)
            suggestions.append(f"Overpaying in price range(s): {buckets} - require higher edge or avoid")
        
        # Find value buckets
        underpriced = [c for c in calibration if c.is_underpriced and c.total_trades >= 3]
        if underpriced:
            buckets = ", ".join(c.price_bucket for c in underpriced)
            suggestions.append(f"Finding edge in range(s): {buckets} - consider increasing allocation")
        
        return suggestions
    
    def _analyze_strategy_allocation(self, trades: list[Trade]) -> list[str]:
        """Analyze strategy allocation."""
        suggestions = []
        
        strategy_perf = self.strategy_evaluator.compare_strategies()
        
        # Find underperforming strategies
        for name, perf in strategy_perf.items():
            if perf.resolved_trades >= 5 and perf.avg_clv < -5:
                suggestions.append(
                    f"Strategy '{name}' has negative edge (CLV: {perf.avg_clv:.1f}%) - reduce allocation or pause"
                )
            elif perf.resolved_trades >= 5 and perf.avg_clv > 5:
                suggestions.append(
                    f"Strategy '{name}' showing strong edge (CLV: {perf.avg_clv:.1f}%) - consider increasing allocation"
                )
        
        return suggestions
    
    def _analyze_position_sizing(self, trades: list[Trade]) -> list[str]:
        """Analyze position sizing patterns."""
        suggestions = []
        
        # Check if larger positions are losing more
        large_trades = [t for t in trades if t.amount > 30]
        small_trades = [t for t in trades if t.amount <= 30]
        
        if len(large_trades) >= 3 and len(small_trades) >= 3:
            large_clv = mean(t.clv for t in large_trades if t.clv) if any(t.clv for t in large_trades) else 0
            small_clv = mean(t.clv for t in small_trades if t.clv) if any(t.clv for t in small_trades) else 0
            
            if large_clv < small_clv - 3:
                suggestions.append(
                    f"Larger positions underperforming (CLV: {large_clv:.1f}% vs {small_clv:.1f}%) - consider smaller sizes"
                )
        
        return suggestions
    
    def _analyze_timing(self, trades: list[Trade]) -> list[str]:
        """Analyze timing patterns."""
        suggestions = []
        
        # Check CLV by time to expiry (if data available)
        timed_trades = [
            t for t in trades
            if t.market_end_date and t.clv is not None
        ]
        
        if len(timed_trades) >= 5:
            early_trades = [
                t for t in timed_trades
                if (t.market_end_date - t.created_at).days > 7
            ]
            late_trades = [
                t for t in timed_trades
                if (t.market_end_date - t.created_at).days <= 7
            ]
            
            if early_trades and late_trades:
                early_clv = mean(t.clv for t in early_trades)
                late_clv = mean(t.clv for t in late_trades)
                
                if early_clv > late_clv + 3:
                    suggestions.append(
                        f"Better CLV on early entries ({early_clv:.1f}% vs {late_clv:.1f}%) - enter earlier in market lifecycle"
                    )
                elif late_clv > early_clv + 3:
                    suggestions.append(
                        f"Better CLV on late entries ({late_clv:.1f}% vs {early_clv:.1f}%) - wait for price discovery"
                    )
        
        return suggestions
    
    def _analyze_categories(self, trades: list[Trade]) -> list[str]:
        """Analyze performance by category."""
        suggestions = []
        
        categories = defaultdict(list)
        for trade in trades:
            cat = trade.market_category or "uncategorized"
            categories[cat].append(trade)
        
        for cat, cat_trades in categories.items():
            if len(cat_trades) >= 3:
                clv_values = [t.clv for t in cat_trades if t.clv is not None]
                if clv_values:
                    avg_clv = mean(clv_values)
                    if avg_clv < -5:
                        suggestions.append(
                            f"Underperforming in '{cat}' (CLV: {avg_clv:.1f}%) - consider avoiding or reducing"
                        )
                    elif avg_clv > 5:
                        suggestions.append(
                            f"Strong performance in '{cat}' (CLV: {avg_clv:.1f}%) - lean into this category"
                        )
        
        return suggestions
    
    def _analyze_clv_patterns(self, trades: list[Trade]) -> list[str]:
        """Analyze overall CLV patterns."""
        suggestions = []
        
        clv_values = [t.clv for t in trades if t.clv is not None]
        if not clv_values:
            return suggestions
        
        avg_clv = mean(clv_values)
        clv_positive_rate = len([c for c in clv_values if c > 0]) / len(clv_values)
        
        if avg_clv < 0:
            suggestions.append(
                f"Overall negative CLV ({avg_clv:.1f}%) - market is consistently pricing better than us"
            )
            if clv_positive_rate < 0.4:
                suggestions.append(
                    "Entry timing consistently poor - consider using limit orders or waiting for price moves"
                )
        elif avg_clv > 3:
            suggestions.append(
                f"Consistently beating closing line ({avg_clv:.1f}% CLV) - edge is real, maintain discipline"
            )
        
        return suggestions


# Convenience function for quick analysis
def analyze_and_improve(trades: list[Trade]) -> dict:
    """Run full analysis and return comprehensive report.
    
    Args:
        trades: List of trades to analyze
        
    Returns:
        Dict with performance metrics, calibration, and improvements
    """
    evaluator = StrategyEvaluator(trades)
    tuner = ParameterTuner(trades)
    analyzer = ResolutionAnalyzer(trades)
    
    resolved = [
        t for t in trades
        if t.status in (TradeStatus.RESOLVED_WIN, TradeStatus.RESOLVED_LOSS)
    ]
    
    return {
        "summary": {
            "total_trades": len(trades),
            "resolved": len(resolved),
            "open": len([t for t in trades if t.status == TradeStatus.OPEN]),
        },
        "strategy_performance": evaluator.compare_strategies(),
        "calibration": tuner.calculate_calibration(),
        "improvements": tuner.suggest_improvements(),
        "optimal_parameters": tuner.get_optimal_parameters(),
        "recent_lessons": [
            analyzer.generate_lesson_summary(t)
            for t in sorted(resolved, key=lambda x: x.resolution_date or x.created_at, reverse=True)[:5]
        ],
    }
