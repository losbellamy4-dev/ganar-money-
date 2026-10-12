"""Genera fixtures de verificación cruzada con python-stdnum (biblioteca independiente).

Uso (solo desarrollo):
    python3 -m venv .venv && .venv/bin/pip install python-stdnum
    .venv/bin/python -I scripts/crosscheck/gen_fixtures.py > test/fixtures/stdnum-crosscheck.json

Las pruebas de Node comparan nuestras implementaciones con los veredictos de stdnum.
"""
import json
import random

from stdnum import iban as std_iban
from stdnum.es import ccc, cif, dni, nie, nif
from stdnum.eu import at_02

rng = random.Random(20261012)
DIGITS = "0123456789"
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def rand_digits(n):
    return "".join(rng.choice(DIGITS) for _ in range(n))


def spanish_iban():
    bank, branch, account = rand_digits(4), rand_digits(4), rand_digits(10)
    check = ccc.calc_check_digits(bank + branch + "00" + account)
    bban = bank + branch + check + account
    return "ES" + std_iban.calc_check_digits("ESXX" + bban) + bban


def foreign_iban(country, length):
    bban = rand_digits(length - 4)
    return country + std_iban.calc_check_digits(country + "XX" + bban) + bban


def mutate(value):
    i = rng.randrange(4, len(value))
    ch = value[i]
    pool = DIGITS if ch.isdigit() else LETTERS
    new = rng.choice([c for c in pool if c != ch])
    return value[:i] + new + value[i + 1:]


def random_dni():
    num = rand_digits(8)
    return num + dni.calc_check_digit(num)


def random_nie():
    body = rng.choice("XYZ") + rand_digits(7)
    return body + nie.calc_check_digit(body)


def random_klm():
    body = rng.choice("KLM") + rand_digits(7)
    return body + dni.calc_check_digit(body[1:])


def random_cif():
    first = rng.choice("ABEHPQSNWCDFGJUV")
    body = first + rand_digits(7)
    digit, letter = cif.calc_check_digits(body)
    if first in "PQSNW":
        last = letter
    elif first in "ABEH":
        last = digit
    else:
        last = rng.choice([digit, letter])
    return body + last


ibans = []
for _ in range(300):
    v = spanish_iban()
    ibans.append({"value": v, "valid": std_iban.is_valid(v) and ccc.is_valid(v[4:])})
    m = mutate(v)
    ibans.append({"value": m, "valid": std_iban.is_valid(m) and ccc.is_valid(m[4:])})
for country, length in [("DE", 22), ("FR", 27), ("PT", 25), ("NL", 18), ("IT", 27), ("BE", 16)]:
    for _ in range(20):
        # Para países extranjeros comparamos solo el control mod 97 (stdnum valida además el BBAN nacional).
        v = foreign_iban(country, length)
        ibans.append({"value": v, "mod97": std_iban.mod_97_10.is_valid(v[4:] + v[:4])})
        m = mutate(v)
        ibans.append({"value": m, "mod97": std_iban.mod_97_10.is_valid(m[4:] + m[:4])})

tax_ids = []
for gen in (random_dni, random_nie, random_cif, random_klm):
    for _ in range(150):
        v = gen()
        ok = nif.is_valid(v)
        tax_ids.append({"value": v, "valid": ok})
        m = v[:-1] + rng.choice([c for c in (LETTERS + DIGITS) if c != v[-1]])
        okm = nif.is_valid(m)
        tax_ids.append({"value": m, "valid": okm})

creditor_ids = []
for t in tax_ids[::3]:
    suffix = rng.choice(["000", "001", "ZZZ", "A01"])
    cid = "ES" + at_02.calc_check_digits("ESXX" + suffix + t["value"]) + suffix + t["value"]
    creditor_ids.append({"nationalId": t["value"], "suffix": suffix, "expected": cid, "valid": at_02.is_valid(cid)})
    if rng.random() < 0.5:
        other = rng.choice([f"{n:02d}" for n in range(100) if f"{n:02d}" != cid[2:4]])
        mc = cid[:2] + other + cid[4:]
    else:
        mc = cid[:-1] + rng.choice([c for c in DIGITS + LETTERS if c != cid[-1]])
    creditor_ids.append({"value": mc, "valid": at_02.is_valid(mc)})

print(json.dumps({"generator": "python-stdnum", "ibans": ibans, "taxIds": tax_ids, "creditorIds": creditor_ids}, indent=1))
