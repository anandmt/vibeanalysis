#!/usr/bin/env python3
"""
Generate e-commerce sales data with realistic patterns:
- customers: 500 records
- products: 50 items
- orders: 1000 transactions

Features:
- Realistic pricing by category with margins
- Seasonal demand (holiday spike, summer dip), weekly effects
- Customer behavior: repeat purchases via activity scoring
- Category seasonal skews (e.g., toys in Dec, outdoor in summer)

Outputs: CSV files written to ./data/
"""

from __future__ import annotations

import csv
import math
import os
import random
from dataclasses import dataclass, asdict, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Tuple


RANDOM_SEED = int(os.environ.get("DATA_SEED", "42"))
random.seed(RANDOM_SEED)


# ---------------------- helpers ----------------------

def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def weighted_choice(items: List, weights: List[float]):
    total = sum(weights)
    r = random.uniform(0, total)
    upto = 0.0
    for item, w in zip(items, weights):
        upto += w
        if upto >= r:
            return item
    return items[-1]


def lognormal(mu: float, sigma: float) -> float:
    # Sample from lognormal with given mu, sigma (of underlying normal)
    return random.lognormvariate(mu, sigma)


def zipf_like(n: int, s: float = 1.1) -> List[float]:
    # Simple Zipf weights
    return [1 / (i + 1) ** s for i in range(n)]


def random_name() -> Tuple[str, str]:
    first_names = (
        "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Skyler",
        "Jamie", "Cameron", "Drew", "Logan", "Quinn", "Rowan", "Harper", "Parker",
        "Charlie", "Emerson", "Reese", "Sage",
    )
    last_names = (
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
        "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
        "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    )
    return random.choice(first_names), random.choice(last_names)


def random_email(first: str, last: str) -> str:
    domains = ("example.com", "mail.com", "inbox.com", "shopper.net")
    num = random.randint(1, 9999)
    return f"{first.lower()}.{last.lower()}{num}@{random.choice(domains)}"


def random_city_state_country() -> Tuple[str, str, str]:
    cities = [
        ("New York", "NY", "USA"), ("Los Angeles", "CA", "USA"), ("Chicago", "IL", "USA"),
        ("Houston", "TX", "USA"), ("Phoenix", "AZ", "USA"), ("Philadelphia", "PA", "USA"),
        ("San Antonio", "TX", "USA"), ("San Diego", "CA", "USA"), ("Dallas", "TX", "USA"),
        ("San Jose", "CA", "USA"), ("Toronto", "ON", "Canada"), ("Vancouver", "BC", "Canada"),
        ("London", "", "UK"), ("Manchester", "", "UK"), ("Sydney", "NSW", "Australia"),
        ("Melbourne", "VIC", "Australia"), ("Berlin", "", "Germany"), ("Paris", "", "France"),
    ]
    return random.choice(cities)


def daterange(days_back: int = 365) -> List[date]:
    today = date.today()
    return [today - timedelta(days=i) for i in range(days_back)][::-1]


def month_season_multiplier(month: int) -> float:
    # Dec/Nov spike, summer dip, small back-to-school bump in Sep
    if month in (11, 12):
        return 1.8
    if month in (6, 7):
        return 0.85
    if month == 9:
        return 1.15
    if month in (3, 4):  # spring lift
        return 1.1
    return 1.0


def weekday_multiplier(d: date) -> float:
    # Slightly more orders Fri-Sun
    if d.weekday() in (4, 5):  # Fri, Sat
        return 1.15
    if d.weekday() == 6:  # Sun
        return 1.1
    return 0.95


def category_month_multiplier(category: str, month: int) -> float:
    # Category-specific seasonal lift
    if category == "Toys":
        return 1.6 if month in (11, 12) else 0.9
    if category == "Outdoor":
        return 1.4 if month in (5, 6, 7, 8) else 0.9
    if category == "Apparel":
        return 1.2 if month in (9, 10) else 1.0
    if category == "Electronics":
        return 1.3 if month in (11, 12) else 1.0
    if category == "Home":
        return 1.15 if month in (3, 4, 5) else 1.0
    if category == "Beauty":
        return 1.1
    return 1.0


# ---------------------- data classes ----------------------


@dataclass
class Customer:
    customer_id: str
    first_name: str
    last_name: str
    email: str
    signup_date: date
    city: str
    state: str
    country: str
    segment: str
    activity_score: float
    total_orders: int = 0
    total_spent: float = 0.0


@dataclass
class Product:
    product_id: str
    name: str
    category: str
    base_price: float
    unit_cost: float
    popularity_weight: float
    sku: str


@dataclass
class Order:
    order_id: str
    order_date: datetime
    customer_id: str
    product_id: str
    quantity: int
    unit_price: float
    discount: float
    channel: str
    payment_method: str


# ---------------------- generation ----------------------


def generate_customers(n: int) -> List[Customer]:
    customers: List[Customer] = []
    base_date = date.today() - timedelta(days=730)  # signups within last ~2 years
    for i in range(1, n + 1):
        first, last = random_name()
        email = random_email(first, last)
        city, state, country = random_city_state_country()
        # Signup dates skewed towards more recent months
        signup_offset = int(lognormal(mu=2.0, sigma=1.0))
        signup_offset = max(0, min(700, signup_offset))
        signup = base_date + timedelta(days=signup_offset)
        # Activity score via lognormal (heavy-tail)
        activity = lognormal(mu=0.0, sigma=1.0)
        # Segment by activity
        if activity > 3.0:
            segment = "VIP"
        elif activity > 1.5:
            segment = "Returning"
        else:
            segment = "New"
        customers.append(
            Customer(
                customer_id=f"C{i:04d}",
                first_name=first,
                last_name=last,
                email=email,
                signup_date=signup,
                city=city,
                state=state,
                country=country,
                segment=segment,
                activity_score=activity,
            )
        )
    return customers


def generate_products(n: int) -> List[Product]:
    categories = ["Electronics", "Apparel", "Home", "Beauty", "Outdoor", "Toys"]
    names_by_cat: Dict[str, List[str]] = {
        "Electronics": [
            "Wireless Headphones", "Smartphone", "Bluetooth Speaker", "Gaming Mouse",
            "4K Monitor", "Smartwatch", "Tablet", "Portable SSD",
        ],
        "Apparel": [
            "Graphic T-Shirt", "Running Shoes", "Hooded Sweatshirt", "Jeans",
            "Athletic Shorts", "Rain Jacket", "Socks Pack", "Yoga Pants",
        ],
        "Home": [
            "LED Lamp", "Coffee Maker", "Air Fryer", "Vacuum Cleaner",
            "Throw Blanket", "Ceramic Mugs", "Desk Organizer", "Bedding Set",
        ],
        "Beauty": [
            "Moisturizer", "Vitamin C Serum", "Shampoo", "Conditioner",
            "Facial Cleanser", "Lipstick", "Sunscreen", "Hair Dryer",
        ],
        "Outdoor": [
            "Camping Tent", "Hiking Backpack", "Insulated Water Bottle", "Portable Grill",
            "Cycling Helmet", "Picnic Set", "Sleeping Bag", "Foldable Chair",
        ],
        "Toys": [
            "Building Blocks", "RC Car", "Puzzle Set", "Dollhouse",
            "Action Figure", "Board Game", "Craft Kit", "Science Kit",
        ],
    }
    # Price ranges by category
    price_ranges = {
        "Electronics": (40, 1200),
        "Apparel": (10, 150),
        "Home": (15, 300),
        "Beauty": (8, 80),
        "Outdoor": (20, 500),
        "Toys": (10, 150),
    }

    products: List[Product] = []
    pid = 1
    while len(products) < n:
        cat = random.choice(categories)
        name = random.choice(names_by_cat[cat])
        # Base price via lognormal within category range
        low, high = price_ranges[cat]
        span = high - low
        p = low + min(span, lognormal(mu=math.log(span / 2), sigma=0.9))
        p = max(low * 0.9, min(high, p))
        # Cost as 50-75% of base price depending on category
        margin_factor = random.uniform(0.25, 0.5)
        cost = round(p * (1.0 - margin_factor), 2)
        # Popularity via Zipf-like with a bit of noise
        pop = 1.0 / (pid ** 1.05) + random.uniform(0.0, 0.2)
        sku = f"SKU-{cat[:2].upper()}-{pid:04d}"
        products.append(
            Product(
                product_id=f"P{pid:03d}",
                name=name,
                category=cat,
                base_price=round(p, 2),
                unit_cost=cost,
                popularity_weight=pop,
                sku=sku,
            )
        )
        pid += 1
    return products[:n]


def build_date_weights(days: List[date]) -> List[float]:
    weights = []
    for d in days:
        w = month_season_multiplier(d.month) * weekday_multiplier(d)
        # Smooth yearly baseline
        weights.append(w)
    return weights


def generate_orders(n: int, customers: List[Customer], products: List[Product]) -> List[Order]:
    orders: List[Order] = []
    # Customer activity weights
    cust_weights = [c.activity_score for c in customers]
    # Normalize to avoid zero weights
    min_w = min(cust_weights)
    if min_w <= 0:
        cust_weights = [w + abs(min_w) + 0.01 for w in cust_weights]

    # Product popularity weights baseline
    prod_weights = [p.popularity_weight for p in products]

    days = daterange(365)
    day_weights = build_date_weights(days)

    # Black Friday/Cyber Monday promo window: heavy discounts end of Nov
    bf_start = date(date.today().year, 11, 20)
    bf_end = date(date.today().year, 11, 30)

    for i in range(1, n + 1):
        # Sample date
        order_day = weighted_choice(days, day_weights)
        # Sample hour with more purchases in evenings
        hour_weights = [0.6 if 18 <= h <= 22 else 0.4 if 12 <= h <= 14 else 0.2 for h in range(24)]
        hour = weighted_choice(list(range(24)), hour_weights)
        minute = random.randint(0, 59)
        order_dt = datetime(order_day.year, order_day.month, order_day.day, hour, minute)

        # Sample customer and product
        cust = weighted_choice(customers, cust_weights)
        # Adjust product popularity by category season for the chosen month
        month = order_day.month
        adjusted_weights = [
            pw * category_month_multiplier(p.category, month)
            for p, pw in zip(products, prod_weights)
        ]
        prod = weighted_choice(products, adjusted_weights)

        # Quantity: usually 1-3, rarely up to 5 for cheap items
        base_qty = 1 if prod.base_price > 100 else 2
        qty = max(1, min(5, int(round(lognormal(mu=math.log(base_qty), sigma=0.5)))))

        # Discount logic with promotions
        discount = 0.0
        # Occasional markdowns
        if random.random() < 0.15:
            discount = random.choice([0.05, 0.10, 0.15])
        # Extra holiday promotion
        if bf_start <= order_day <= bf_end and prod.category in ("Electronics", "Toys", "Apparel"):
            discount = max(discount, random.choice([0.20, 0.25, 0.30]))

        # Unit price with small stochastic variation
        price_noise = random.uniform(-0.02, 0.03)
        unit_price = round(prod.base_price * (1.0 - discount) * (1.0 + price_noise), 2)

        channel = weighted_choice(["Web", "Mobile"], [0.6, 0.4])
        payment_method = weighted_choice(["Credit Card", "PayPal", "Apple Pay", "Google Pay"], [0.5, 0.2, 0.15, 0.15])

        order = Order(
            order_id=f"O{i:05d}",
            order_date=order_dt,
            customer_id=cust.customer_id,
            product_id=prod.product_id,
            quantity=qty,
            unit_price=unit_price,
            discount=discount,
            channel=channel,
            payment_method=payment_method,
        )
        orders.append(order)

    # Update customer aggregates
    spend_by_customer: Dict[str, float] = {}
    orders_by_customer: Dict[str, int] = {}
    for o in orders:
        spend_by_customer[o.customer_id] = spend_by_customer.get(o.customer_id, 0.0) + o.unit_price * o.quantity
        orders_by_customer[o.customer_id] = orders_by_customer.get(o.customer_id, 0) + 1
    for c in customers:
        c.total_spent = round(spend_by_customer.get(c.customer_id, 0.0), 2)
        c.total_orders = orders_by_customer.get(c.customer_id, 0)

    return orders


# ---------------------- CSV writing ----------------------


def write_customers_csv(path: str, customers: List[Customer]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "customer_id", "first_name", "last_name", "email", "signup_date",
            "city", "state", "country", "segment", "activity_score",
            "total_orders", "total_spent",
        ])
        for c in customers:
            w.writerow([
                c.customer_id, c.first_name, c.last_name, c.email,
                c.signup_date.isoformat(), c.city, c.state, c.country, c.segment,
                round(c.activity_score, 4), c.total_orders, c.total_spent,
            ])


def write_products_csv(path: str, products: List[Product]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "product_id", "name", "category", "base_price", "unit_cost", "sku",
        ])
        for p in products:
            w.writerow([
                p.product_id, p.name, p.category, p.base_price, p.unit_cost, p.sku,
            ])


def write_orders_csv(path: str, orders: List[Order]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "order_id", "order_date", "customer_id", "product_id", "quantity",
            "unit_price", "discount", "channel", "payment_method",
        ])
        for o in orders:
            w.writerow([
                o.order_id, o.order_date.isoformat(timespec="minutes"), o.customer_id,
                o.product_id, o.quantity, o.unit_price, round(o.discount, 2), o.channel,
                o.payment_method,
            ])


def main():
    n_customers = 500
    n_products = 50
    n_orders = 1000

    customers = generate_customers(n_customers)
    products = generate_products(n_products)
    orders = generate_orders(n_orders, customers, products)

    out_dir = os.path.join(os.getcwd(), "data")
    ensure_dir(out_dir)

    write_customers_csv(os.path.join(out_dir, "customers.csv"), customers)
    write_products_csv(os.path.join(out_dir, "products.csv"), products)
    write_orders_csv(os.path.join(out_dir, "orders.csv"), orders)

    print(f"Generated {n_customers} customers -> {os.path.join(out_dir, 'customers.csv')}")
    print(f"Generated {n_products} products -> {os.path.join(out_dir, 'products.csv')}")
    print(f"Generated {n_orders} orders -> {os.path.join(out_dir, 'orders.csv')}")


if __name__ == "__main__":
    main()

