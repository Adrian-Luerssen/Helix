"""Polymarket platform adapter.

Uses:
- Gamma API (https://gamma-api.polymarket.com) for market discovery and metadata
- CLOB API (https://clob.polymarket.com) for orderbook and prices
"""

import json
import uuid
from datetime import datetime
from typing import Any, Optional

import httpx

from ..models.market import Market


class PolymarketAdapter:
    """Adapter for Polymarket prediction markets."""
    
    GAMMA_BASE_URL = "https://gamma-api.polymarket.com"
    CLOB_BASE_URL = "https://clob.polymarket.com"
    PLATFORM_NAME = "polymarket"
    
    def __init__(self, timeout: float = 30.0):
        """Initialize the adapter.
        
        Args:
            timeout: HTTP request timeout in seconds
        """
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
        
        # Paper trading state (in-memory for now)
        self._paper_orders: dict[str, dict] = {}
        self._paper_positions: dict[str, dict] = {}
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client
    
    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
    
    # =========================================================================
    # Market Discovery (Gamma API)
    # =========================================================================
    
    async def get_markets(
        self,
        category: Optional[str] = None,
        limit: int = 100,
        active_only: bool = True,
        closed: bool = False,
    ) -> list[Market]:
        """Fetch markets from Polymarket.
        
        Args:
            category: Filter by category (e.g., "Politics", "Crypto", "Sports")
            limit: Maximum number of markets to return
            active_only: Only return active markets
            closed: Include closed markets
            
        Returns:
            List of Market objects
        """
        client = await self._get_client()
        
        params: dict[str, Any] = {"limit": limit}
        if active_only:
            params["active"] = "true"
        if not closed:
            params["closed"] = "false"
        
        response = await client.get(
            f"{self.GAMMA_BASE_URL}/markets",
            params=params
        )
        response.raise_for_status()
        
        raw_markets = response.json()
        markets = []
        
        for raw in raw_markets:
            # Filter by category if specified
            if category:
                market_category = raw.get("category", "")
                # Also check event category
                events = raw.get("events", [])
                event_categories = [e.get("category", "") for e in events]
                all_categories = [market_category] + event_categories
                
                if not any(category.lower() in c.lower() for c in all_categories if c):
                    continue
            
            market = self._parse_market(raw)
            if market:
                markets.append(market)
        
        return markets[:limit]
    
    async def get_market(self, market_id: str) -> Optional[Market]:
        """Fetch a single market by ID.
        
        Args:
            market_id: The Polymarket market ID
            
        Returns:
            Market object or None if not found
        """
        client = await self._get_client()
        
        response = await client.get(
            f"{self.GAMMA_BASE_URL}/markets/{market_id}"
        )
        
        if response.status_code == 404:
            return None
        response.raise_for_status()
        
        raw = response.json()
        return self._parse_market(raw)
    
    def _parse_market(self, raw: dict) -> Optional[Market]:
        """Parse raw API response into Market model.
        
        Args:
            raw: Raw market data from Gamma API
            
        Returns:
            Market object or None if parsing fails
        """
        try:
            market_id = str(raw["id"])
            
            # Parse outcome prices (JSON array as string)
            yes_price = None
            no_price = None
            outcome_prices = raw.get("outcomePrices")
            if outcome_prices:
                if isinstance(outcome_prices, str):
                    prices = json.loads(outcome_prices)
                else:
                    prices = outcome_prices
                if len(prices) >= 2:
                    yes_price = float(prices[0]) if prices[0] else None
                    no_price = float(prices[1]) if prices[1] else None
            
            # Parse end date
            end_date = None
            end_date_str = raw.get("endDate")
            if end_date_str:
                try:
                    end_date = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass
            
            # Determine category
            category = raw.get("category")
            if not category:
                events = raw.get("events", [])
                if events:
                    category = events[0].get("category")
            
            # Parse first seen date
            first_seen_str = raw.get("createdAt")
            first_seen = datetime.utcnow()
            if first_seen_str:
                try:
                    first_seen = datetime.fromisoformat(first_seen_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass
            
            # Parse last updated
            updated_str = raw.get("updatedAt")
            last_updated = datetime.utcnow()
            if updated_str:
                try:
                    last_updated = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass
            
            return Market(
                id=f"{self.PLATFORM_NAME}:{market_id}",
                platform=self.PLATFORM_NAME,
                market_id=market_id,
                question=raw.get("question", ""),
                description=raw.get("description"),
                category=category,
                end_date=end_date,
                yes_price=yes_price,
                no_price=no_price,
                volume=raw.get("volumeNum") or (float(raw["volume"]) if raw.get("volume") else None),
                liquidity=raw.get("liquidityNum") or (float(raw["liquidity"]) if raw.get("liquidity") else None),
                resolved=raw.get("closed", False),
                resolution_outcome=raw.get("outcome"),
                first_seen=first_seen,
                last_updated=last_updated,
            )
        except (KeyError, ValueError, TypeError) as e:
            # Log error in production
            print(f"Failed to parse market: {e}")
            return None
    
    # =========================================================================
    # Prices (CLOB API)
    # =========================================================================
    
    async def get_prices(self, market_id: str) -> dict[str, Optional[float]]:
        """Get current prices for a market.
        
        Uses the CLOB API to get precise midpoint prices for the outcome tokens.
        
        Args:
            market_id: The Polymarket market ID
            
        Returns:
            Dict with 'yes_price', 'no_price' keys
        """
        # First get market to get token IDs
        market = await self.get_market(market_id)
        if not market:
            return {"yes_price": None, "no_price": None}
        
        # Get token IDs from the raw market data
        client = await self._get_client()
        response = await client.get(f"{self.GAMMA_BASE_URL}/markets/{market_id}")
        response.raise_for_status()
        raw = response.json()
        
        clob_token_ids = raw.get("clobTokenIds")
        if not clob_token_ids:
            # Return prices from market data if no CLOB tokens
            return {
                "yes_price": market.yes_price,
                "no_price": market.no_price,
            }
        
        if isinstance(clob_token_ids, str):
            token_ids = json.loads(clob_token_ids)
        else:
            token_ids = clob_token_ids
        
        if len(token_ids) < 2:
            return {
                "yes_price": market.yes_price,
                "no_price": market.no_price,
            }
        
        yes_token_id = token_ids[0]
        no_token_id = token_ids[1]
        
        # Fetch midpoint prices from CLOB
        yes_price = await self._get_midpoint(yes_token_id)
        no_price = await self._get_midpoint(no_token_id)
        
        return {
            "yes_price": yes_price,
            "no_price": no_price,
        }
    
    async def _get_midpoint(self, token_id: str) -> Optional[float]:
        """Get midpoint price for a token from CLOB API.
        
        Args:
            token_id: The CLOB token ID
            
        Returns:
            Midpoint price or None
        """
        client = await self._get_client()
        
        try:
            response = await client.get(
                f"{self.CLOB_BASE_URL}/midpoint",
                params={"token_id": token_id}
            )
            response.raise_for_status()
            data = response.json()
            mid = data.get("mid")
            return float(mid) if mid else None
        except (httpx.HTTPError, ValueError, TypeError):
            return None
    
    async def get_orderbook(self, market_id: str, side: str = "YES") -> dict:
        """Get orderbook for a market outcome.
        
        Args:
            market_id: The Polymarket market ID
            side: "YES" or "NO"
            
        Returns:
            Orderbook data with bids and asks
        """
        client = await self._get_client()
        
        # Get token ID
        response = await client.get(f"{self.GAMMA_BASE_URL}/markets/{market_id}")
        response.raise_for_status()
        raw = response.json()
        
        clob_token_ids = raw.get("clobTokenIds")
        if not clob_token_ids:
            return {"bids": [], "asks": [], "market": market_id}
        
        if isinstance(clob_token_ids, str):
            token_ids = json.loads(clob_token_ids)
        else:
            token_ids = clob_token_ids
        
        token_idx = 0 if side.upper() == "YES" else 1
        if len(token_ids) <= token_idx:
            return {"bids": [], "asks": [], "market": market_id}
        
        token_id = token_ids[token_idx]
        
        # Fetch orderbook from CLOB
        book_response = await client.get(
            f"{self.CLOB_BASE_URL}/book",
            params={"token_id": token_id}
        )
        book_response.raise_for_status()
        
        return book_response.json()
    
    # =========================================================================
    # Paper Trading (Stubs)
    # =========================================================================
    
    async def place_order(
        self,
        market_id: str,
        side: str,
        price: float,
        amount: float,
    ) -> str:
        """Place a paper trading order.
        
        This is a stub for paper trading - no real orders are placed.
        
        Args:
            market_id: The Polymarket market ID
            side: "YES" or "NO"
            price: Order price (0.00 to 1.00)
            amount: Amount in USDC
            
        Returns:
            Paper order ID
        """
        order_id = f"paper_{uuid.uuid4().hex[:12]}"
        
        self._paper_orders[order_id] = {
            "order_id": order_id,
            "market_id": market_id,
            "side": side.upper(),
            "price": price,
            "amount": amount,
            "status": "open",
            "created_at": datetime.utcnow().isoformat(),
            "filled_at": None,
            "paper_trading": True,
        }
        
        # For simplicity, immediately "fill" market orders at the specified price
        # In a real implementation, this would check the orderbook
        shares = amount / price
        position_key = f"{market_id}:{side.upper()}"
        
        if position_key not in self._paper_positions:
            self._paper_positions[position_key] = {
                "market_id": market_id,
                "side": side.upper(),
                "shares": 0,
                "avg_price": 0,
                "total_cost": 0,
            }
        
        pos = self._paper_positions[position_key]
        new_shares = pos["shares"] + shares
        new_cost = pos["total_cost"] + amount
        pos["shares"] = new_shares
        pos["total_cost"] = new_cost
        pos["avg_price"] = new_cost / new_shares if new_shares > 0 else 0
        
        self._paper_orders[order_id]["status"] = "filled"
        self._paper_orders[order_id]["filled_at"] = datetime.utcnow().isoformat()
        self._paper_orders[order_id]["shares_filled"] = shares
        
        return order_id
    
    async def get_positions(self) -> list[dict]:
        """Get paper trading positions.
        
        Returns:
            List of position dicts
        """
        return [
            {
                **pos,
                "position_id": key,
                "paper_trading": True,
            }
            for key, pos in self._paper_positions.items()
            if pos["shares"] > 0
        ]
    
    async def get_order(self, order_id: str) -> Optional[dict]:
        """Get a paper order by ID.
        
        Args:
            order_id: The paper order ID
            
        Returns:
            Order dict or None
        """
        return self._paper_orders.get(order_id)
    
    async def cancel_order(self, order_id: str) -> bool:
        """Cancel a paper order.
        
        Args:
            order_id: The paper order ID
            
        Returns:
            True if cancelled, False if not found or already filled
        """
        order = self._paper_orders.get(order_id)
        if not order:
            return False
        if order["status"] != "open":
            return False
        
        order["status"] = "cancelled"
        return True
