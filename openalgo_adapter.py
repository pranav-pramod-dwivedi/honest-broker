"""
HonestBroker Adapter for OpenAlgo
Routes OpenAlgo order placement and quotes directly through HonestBroker's
uncompromising spread, slippage, and fee engine.
"""
import requests

class HonestBrokerClient:
    def __init__(self, base_url: str = "http://127.0.0.1:5050"):
        self.base_url = base_url.rstrip("/")

    def place_order(self, symbol: str, action: str, quantity: float, sl: float = None, tp: float = None):
        url = f"{self.base_url}/api/order"
        payload = {
            "symbol": symbol,
            "action": action,
            "quantity": quantity,
            "stop_loss": sl,
            "take_profit": tp
        }
        res = requests.post(url, json=payload)
        return res.json()

    def close_position(self, symbol: str):
        url = f"{self.base_url}/api/close"
        res = requests.post(url, json={"symbol": symbol})
        return res.json()

    def get_quote(self, symbol: str = "SOLUSDT"):
        url = f"{self.base_url}/api/quote?symbol={symbol}"
        return requests.get(url).json()

    def get_account_state(self):
        url = f"{self.base_url}/api/state"
        return requests.get(url).json()

if __name__ == "__main__":
    client = HonestBrokerClient()
    print("Testing connection to HonestBroker...")
    q = client.get_quote("SOLUSDT")
    print("Live Quote:", q)
    state = client.get_account_state()
    print("Account Balance:", state["stats"]["current_balance"])
