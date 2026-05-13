import json
import os
import sys
import time

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.edge.options import Options
from selenium.webdriver.edge.service import Service
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


_driver = None


def _get_driver():
    global _driver
    if _driver:
        return _driver

    options = Options()
    options.add_argument("--window-position=-32000,-32000")
    options.add_argument("--window-size=1280,900")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--log-level=3")
    options.add_experimental_option("excludeSwitches", ["enable-logging", "enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    service = Service(log_output=open(os.devnull, "w"))
    _driver = webdriver.Edge(options=options, service=service)
    return _driver


def lookup(word: str) -> str:
    driver = _get_driver()
    driver.get(f"https://www.bing.com/search?q={word.strip()}+meaning")

    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "dict-common-module"))
        )
        time.sleep(1)
    except Exception:
        return ""

    soup = BeautifulSoup(driver.page_source, "html.parser")
    card = soup.find("dict-common-module")
    if not card:
        return ""

    lines = []
    for nhom in card.find_all("div", class_="common-module-group"):
        pos_el = nhom.find(class_="common-definitions-pos-inner")
        pos = pos_el.get_text(strip=True).upper() if pos_el else "UNKNOWN"
        lines.append(f"[{pos}]")
        for i, item in enumerate(nhom.find_all("li", class_="common-definition-content")[:2], 1):
            maindef = item.find(class_="common-module-maindef")
            if maindef:
                lines.append(f"  {i}. {maindef.get_text(strip=True)}")

    return "\n".join(lines)


def fetch_bing_definition(word: str) -> str:
    return lookup(word)


def main() -> int:
    word = " ".join(sys.argv[1:]).strip()
    definition = lookup(word) if word else ""
    print(json.dumps({"definition": definition}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
