#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PYRAMID DNA / SafeNet KZ, track 3 — demonstrational rule-based engine.

Two-file setup:
  pyramid_dna_engine.py
  safenet_kz_pyramid_dna_dataset.jsonl

No pip installs needed; Python 3.10+; standard library only.
All bundled records are SYNTHETIC. No official police integration, live crawler,
WhatsApp ingestion, or OCR over real images is present. `screenshot_ocr` records
contain SIMULATED TRANSCRIPTIONS, not original image files.

Commands (run in the same folder):
  python pyramid_dna_engine.py validate
  python pyramid_dna_engine.py stats
  python pyramid_dna_engine.py analyze --text 'Взнос 5000 ₸, выплата 10000 ₸, пригласи 2 друзей'
  python pyramid_dna_engine.py analyze --record-id PDNA-0001
  python pyramid_dna_engine.py neighbors --record-id PDNA-0001 --top 5
  python pyramid_dna_engine.py evaluate --split test
  python pyramid_dna_engine.py batch --split test --output predictions.jsonl
  python pyramid_dna_engine.py demo

JSONL schema: id, split, language, modality, source_type, provenance,
  archetype, mechanism_id, risk_label, geography_hint, text, expected, notes.
  risk_label: high = multiple concerning indicators, medium = needs context,
  low = benign / warning. Labels do NOT mean a legal finding.
  mechanism_id links paraphrases of ONE FICTIONAL SCENARIO, NOT real people.
  expected is human-designed scenario annotation and never used in inference.

Public API:
  analyze(text: str) -> dict
  compare(left_analysis: dict, right_analysis: dict) -> dict
  load_records(path: str | Path) -> list[dict]

Intent: technical hackathon baseline. Evaluate on newly collected, authorized,
independently annotated real material BEFORE making real-world accuracy claims.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
import json
import math
from pathlib import Path
import random
import re
import sys
import unicodedata
from typing import Any

DEFAULT_DATA = Path(__file__).with_name('safenet_kz_pyramid_dna_dataset.jsonl')

_NUMBER = r'\d{1,3}(?:[\s\u00a0._]\d{3})+(?:[.,]\d{1,2})?|\d{1,9}(?:[.,]\d{1,2})?'
_CURRENCY = (r'USDT\b|\bUSD\b|\bEUR\b|\bKZT\b|\bBTC\b|\bETH\b|'
             r'₸|\$|€|тг\b|тенге\b|теңге\b|tg\b|доллар(?:а|ов|ы)?(?:\s+США)?|'
             r'евро\b|еуро\b|АҚШ\s+доллар(?:ы|ына|ынан|мен)?|'
             r'биткоин(?:а|ов)?|эфир(?:а|ов)?')
# A currency marker is mandatory: naked counts and days are not money.
MONEY_RE = re.compile(
    rf'(?<![\w])(?:(?P<currency_pre>{_CURRENCY})\s*)?(?P<first>{_NUMBER})\s*(?P<mult>тыс\.?|мың|млн|k|к)?\s*'
    rf'(?:(?:-|–|—|\bдо\b|\bto\b)\s*(?P<second>{_NUMBER})\s*(?P<mult2>тыс\.?|мың|млн|k|к)?\s*)?'
    rf'(?P<currency>{_CURRENCY})?', re.I)
CURRENCY_RE = MONEY_RE  # Public compatibility alias; parsed values are no longer tenge-only.
DAY_RE = re.compile(r'(?<!\d)(\d{1,3})\s*(?:дн(?:ей|я|\.?)|день|дня|күн(?:де|нен|ге|дік)?|kun(?:de|ge)?|dn\b)', re.I)
PERIOD_RE = re.compile(r'(?<!\d)(\d{1,3})\s*(дн(?:ей|я)?|день|дня|дней|күн(?:де|нен|ге|дік)?|недел(?:ю|и|ь)|апта(?:да|дан)?|месяц(?:а|ев)?|ай(?:да|дан)?|год(?:а|у|овой)?|жыл(?:да|дық)?|month(?:ly)?|week(?:ly)?|year(?:ly)?)', re.I)
PERCENT_RE = re.compile(r'(?<![\w])(?P<low>\d+(?:[.,]\d+)?)\s*(?:[-–—]|\bдо\b|\bto\b)?\s*(?P<high>\d+(?:[.,]\d+)?)?\s*(?:%|процент(?:а|ов)?|пайыз(?:ға|дық)?|percent(?:age)?)', re.I)
REF_COUNT_RE = re.compile(r'(?<!\d)(\d{1,2})\s*(?:чел(?:овек|овека|овеков|\.)?|друз(?:ей|ья)|'
                          r'знаком(?:ых|ыми)|реферал(?:ов|а|ы)?|приглашен(?:ия|ий)?|'
                          r'участник(?:ов|а)?|адам|адам(?:ды|ға)?|серіктес|партн(?:ёров|еров))', re.I)

# Context dictionaries are evidence features, not legal criteria.
DEPOSIT = (
    'взнос','вклад','влож','внести','внести','внес','вступлен','депозит','залог','предоплат',
    'оплатой','оплата','платёж','платеж','салым','жарна','алдын ала','ақша сал','салу керек',
    'төлеу','төлейсің','сұрайды','kirу','kiru','salym','zharna','depozit','sal dep',
    'salym sur','сал деп','капитал','пакет','инвест','salymnan','kiruge','участие',
    'перевод','аудару','аударым','audarym','вход ', 'на карту','личный перевод',
    'енгізсе','жинап','жина','сбор ', 'ерікті','erikti','sal ','сал,','клуб','мүшелік','мүшелік төлем',
    'шектеулі уақытқа','предлагают вступить','кір', 'кірген', 'алдын ала'
)
RETURN = (
    'выплат','доход','прибыл','заработ','возврат','верн','получи','обеща','вывести',
    'фиксирован','табыс','пайда','төлем','қайтар','қайтары','аласың','алуға','кепілді төлем',
    'tabys','payda','tolem','qaytar','uade','alaсын','ал','bonus','бонус','поступлен','получено'
)
GUARANTEE = (
    'гарантир','гарантирован','гарант.','без риска','риска нет','фиксирован',
    'кепілді','kepildi','кепілден','täuekel zhok','tauekel zhok','тәуекел жоқ','kepildik bar'
)
REFERRAL = (
    'приглас','приглаш','реферал','привле','привест','друзей','знакомых','партнёр','партнер',
    'қатысушы тарт','адам шақыр','адам тарт','серіктес шақыр','shakyr','adam shakyr',
    'дос шақыр','таныс әкел','таныс әкелгенге','adam tart','seriktes'
)
PERSONAL = ('личн','частную карту','жеке карта','zheke audarym','zheke kart','на карту')
URGENCY = ('только сегодня','сегодня последний','срочно','успей','последний день',
           'до вечера','бүгінге дейін','бүгін соңғы','bugin songy','шұғыл','шектеулі уақыт')
TASKS = ('задани','подработ','за простые задания','тапсырма','tapsyrma','вакансии','онлайн жұмыс','жұмыс ұсынысында')
SCREENSHOT = ('скрин','screenshot','түсті','скриншот','поступлением','чек')
UNCERTAIN = ('нет условий','не сообща','не указан','непонятно','неясно','ничего не известно',
             'не объясняется','не объясняют','неизвестны','не представлены','не представил','не уточн',
             'отсутствует','отсутствуют','неизвестн','не гарант','гарантии нет','нет гарант',
             'не дана','непонятно','не извест','белгісіз','анық емес','жоқ','мәлімет жоқ','пока нет','пока не',
             'не дали','но точных условий нет','ақысы көрсетілмеген','нақты бюджет белгісіз',
             'esep azir joq','кепілденбеген','шығын болуы мүмкін','болжам','прогноз',
             'көрсетілмеген','ақпарат жоқ','aitylmagan','belgisiz','kepildik zhok',
             'tabys kozi zhok','naqty','shartry zhok','есеп жоқ','неизвестен','документов')
WARNING = ('предупрежден','разоблачен','разоблачение','не переводите','не перечисляйте',
           'не доверя','мошенники могут','осторожно','ескерту','сенбеңіз','ақша аудармаңыз',
           'senbeniz','audarmanyz','алаяқтық туралы ескерту','учебном примере показаны признаки')
SAFETY = ('оплата товара','покупк','тауар','доставка','жеткізу','тауарға','tаuar','tauar',
          'возврат долга','личного займа','қарыз','qaryz','родственник','туыс',
          'зарплат','жалақы','zhalaqy','оплату выполненной работы','по договору','еңбекке',
          'бесплатн','бесплатно','тегін','tegin','без оплаты','без взноса','жарна жоқ',
          'аренда зала','зал арендасына','залды жалға алу','смета','сметы',
          'byudzhet','не инвестиция','инвестиция емес','investitsiya emes','не вложение')

STOPWORDS = {'в','на','из','по','и','или','за','до','для','про','без','как','что','его','её','но',
             'он','она','их','а','у','был','это','бір','және','мен','де','бар','жоқ','да','не'}


def normalize_with_map(source: str) -> tuple[str, list[int], list[int]]:
    """Normalize text and retain original codepoint ranges for every output char."""
    chars: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    for index, char in enumerate(source):
        part = unicodedata.normalize('NFKC', char).lower().replace('ё', 'е')
        if char == '\u200b':
            continue
        part = part.replace('\xa0', ' ')
        for out in part:
            chars.append(out); starts.append(index); ends.append(index + 1)
    # Collapse whitespace while retaining the whole source run in its span.
    out_chars: list[str] = []; out_starts: list[int] = []; out_ends: list[int] = []
    i = 0
    while i < len(chars):
        if chars[i].isspace():
            j = i + 1
            while j < len(chars) and chars[j].isspace(): j += 1
            if out_chars:
                out_chars.append(' '); out_starts.append(starts[i]); out_ends.append(ends[j - 1])
            i = j
            continue
        out_chars.append(chars[i]); out_starts.append(starts[i]); out_ends.append(ends[i]); i += 1
    if out_chars and out_chars[-1] == ' ':
        out_chars.pop(); out_starts.pop(); out_ends.pop()
    return ''.join(out_chars), out_starts, out_ends


def normalize(text: str) -> str:
    """Unicode normalization and simple OCR-safe whitespace/case cleanup."""
    return normalize_with_map(text)[0]


def _utf16_offsets(source: str) -> list[int]:
    result = [0]
    for char in source:
        result.append(result[-1] + (2 if ord(char) > 0xFFFF else 1))
    return result


def _source_span(match_start: int, match_end: int, starts: list[int], ends: list[int], utf16: list[int]) -> tuple[int, int] | None:
    if match_start >= match_end or match_start >= len(starts) or match_end - 1 >= len(ends): return None
    return utf16[starts[match_start]], utf16[ends[match_end - 1]]


def hits(text: str, dictionary: tuple[str, ...]) -> list[str]:
    """Returns explainable trigger substrings; never uses provided gold labels."""
    return sorted(set(term for term in dictionary if term in text), key=len, reverse=True)[:5]


def money_mentions(text: str) -> list[dict[str,Any]]:
    results=[]
    for m in MONEY_RE.finditer(text):
        currency_surface=m.group('currency') or m.group('currency_pre')
        if not currency_surface: continue
        def amount(raw: str, multiplier: str | None) -> float:
            compact=raw.replace(' ','').replace('\u00a0','').replace('_','')
            if ',' in compact and '.' in compact:
                compact=compact.replace('.','').replace(',','.')
            elif ',' in compact:
                tail=compact.rsplit(',',1)[1]
                compact=compact.replace(',','' if len(tail)==3 and len(compact.split(',')[0])<=3 else '.')
            elif '.' in compact:
                tail=compact.rsplit('.',1)[1]
                compact=compact.replace('.','' if len(tail)==3 and len(compact.split('.')[0])<=3 else '.')
            value=float(compact)
            mult=(multiplier or '').lower()
            return value * (1_000_000 if 'млн' in mult else 1000 if mult in ('тыс','тыс.','мың','k','к') else 1)
        first=amount(m.group('first'),m.group('mult'))
        second=amount(m.group('second'),m.group('mult2')) if m.group('second') else first
        currency_raw=currency_surface.casefold()
        currency=('KZT' if currency_raw in ('₸','тг','тенге','теңге','tg','kzt') else
                  'USD' if currency_raw in ('$','usd') or 'доллар' in currency_raw or 'ақш' in currency_raw else
                  'EUR' if currency_raw in ('€','eur','евро','еуро') else
                  'USDT' if currency_raw=='usdt' else 'BTC' if 'btc' in currency_raw or 'биткоин' in currency_raw else
                  'ETH' if 'eth' in currency_raw or 'эфир' in currency_raw else 'KZT')
        if currency_surface == '$': currency='USD'
        if currency_surface == '₸': currency='KZT'
        low,high=sorted((first,second))
        if low <= 0 or high > 10**12: continue
        start,end=m.start(),m.end()
        while start<end and text[start].isspace(): start+=1
        while end>start and text[end-1].isspace(): end-=1
        item={'value':low if low==high else None,'min':low,'max':high,'currency':currency,
              'surface':text[start:end],'start':start,'end':end,'role':'unknown'}
        if currency=='KZT' and low==high and float(low).is_integer(): item['value_kzt']=int(low)
        results.append(item)
    return results


def extract_ref_count(t: str) -> int|None:
    # Look near a recruiting phrase, not at any number.
    for m in REF_COUNT_RE.finditer(t):
        ctx=t[max(0,m.start()-32):min(len(t),m.end()+32)]
        if hits(ctx, REFERRAL) or 'человек' in ctx or 'адам' in ctx or 'реферал' in ctx:
            val=int(m.group(1))
            if 1<=val<=30:return val
    # Some RU and KZ wordings place the count after an inflected term.
    rev=re.search(r'(?:пригласить|привести|привлечение|реферал|шақыру|шақыр|shakyr|серіктес|партнер|участник)\D{0,18}(\d{1,2})\b',t)
    return int(rev.group(1)) if rev and 1 <= int(rev.group(1))<=30 else None


def extract_period_info(t: str) -> dict[str, Any] | None:
    m=PERIOD_RE.search(t)
    if m:
        n=int(m.group(1)); unit=m.group(2).casefold()
        if unit.startswith(('дн','день','дня','дней','күн','kun')): return {'value':n,'unit':'day','min':n,'max':n,'start':m.start(),'end':m.end()}
        if unit.startswith(('нед','апта','week')): return {'value':n,'unit':'week','min':n,'max':n,'start':m.start(),'end':m.end()}
        if unit.startswith(('месяц','ай','month')): return {'value':n,'unit':'month','min':n,'max':n,'start':m.start(),'end':m.end()}
        return {'value':n,'unit':'year','min':n,'max':n,'start':m.start(),'end':m.end()}
    cadence=re.search(r'\b(?:кажд(?:ый|ую|ое)\s+день|ежедневн\w*|daily|күн\s+сайын|күнде)\b',t)
    if cadence: return {'value':1,'unit':'day','min':1,'max':1,'start':cadence.start(),'end':cadence.end()}
    if re.search(r'\b(?:завтра|ертең|erten)\b',t):
        m=re.search(r'\b(?:завтра|ертең|erten)\b',t)
        return {'value':1,'unit':'day','min':1,'max':1,'start':m.start(),'end':m.end()}
    return None


def extract_period(t: str) -> int|None:
    info=extract_period_info(t)
    return info['value'] if info and info['unit']=='day' else None


def get_money_roles(t: str, mentions: list[dict], risky_deposit: bool, return_signal: bool)->tuple[int|None,int|None]:
    if not mentions:return None,None
    # Order can be inverted in Kazakh and Russian. For claims of positive returns,
    # use smaller/larger as a fallback ONLY if deposit and payout cues co-occur.
    vals=[m.get('value_kzt') for m in mentions if m.get('currency')=='KZT' and m.get('value_kzt') is not None]
    if len(vals)>=2 and risky_deposit and return_signal:
        return min(vals),max(vals)
    if risky_deposit and len(vals)>=1:
        return vals[0],None
    return None,None


def _role_money_mentions(text: str, mentions: list[dict], deposits: bool, returns: bool, recruitment: bool) -> None:
    deposit_terms=('взнос','вклад','влож','инвест','депозит','салым','жарна','салу','төл','сбор','оплат')
    payout_terms=('выплат','доход','прибыл','заработ','получи','обеща','табыс','пайда','төлем','қайтар','бонус')
    referral_terms=('реферал','приглас','приглаш','привлеч','знаком','участник','сыйақы','шақыр')
    for m in mentions:
        sentence_breaks=[text.rfind(mark,0,m['start']) for mark in '.!?;\n']
        left=max(max(sentence_breaks,default=-1)+1,m['start']-100)
        next_breaks=[pos for mark in '.!?;\n' if (pos:=text.find(mark,m['end']))>=0]
        right=min(min(next_breaks,default=len(text)),m['end']+100)
        context=text[left:right]
        before=text[left:m['start']]; after=text[m['end']:right]
        candidates=[]
        for terms,kind in ((('ущерб','потер','изъял','арестовал','жәбірлен','залал'),'total_loss'),
                           (('подписк','пакет','стоимость','цена','абонент','бағасы','құны'),'package_cost'),
                           (referral_terms,'referral_reward'),(deposit_terms,'required_contribution'),(payout_terms,'promised_return')):
            occurrences=[(before.rfind(w),len(w)) for w in terms if before.rfind(w)>=0]
            if occurrences: candidates.append((min(len(before)-(pos+term_len) for pos,term_len in occurrences),kind))
            occurrences_after=[after.find(w) for w in terms if after.find(w)>=0]
            if occurrences_after: candidates.append((min(occurrences_after),kind))
        nearest=min(candidates,default=(999,'unknown'))[1]
        if nearest=='total_loss': role='total_loss'; confidence=0.9
        elif nearest=='package_cost': role='package_cost'; confidence=0.82
        elif nearest=='referral_reward' and recruitment: role='referral_reward'; confidence=0.82
        elif nearest=='required_contribution' and deposits: role='required_contribution'; confidence=0.7
        elif nearest=='promised_return' and returns: role='promised_return'; confidence=0.75
        elif deposits: role='required_contribution'; confidence=0.55
        elif returns: role='promised_return'; confidence=0.55
        else: role='unknown'; confidence=0.0
        m['role']=role
        if confidence: m['confidence']=confidence


def _evidence_spans(source: str, normalized: str, starts: list[int], ends: list[int], hits_by_type: dict[str, list[str]], amounts: list[dict], period: dict | None) -> list[dict[str, Any]]:
    utf16=_utf16_offsets(source); found=[]
    definitions={
      'deposit':('Требуемый взнос','Указанный фрагмент описывает внесение средств.'),
      'payout':('Обещанная выплата','Фрагмент упоминает обещанный доход или выплату.'),
      'recruitment':('Привлечение участников','Условие связано с приглашением или привлечением новых участников.'),
      'guarantee':('Гарантия дохода','Фрагмент содержит заявление о гарантированной выплате.'),
      'pressure':('Давление срочностью','Фрагмент ограничивает время для принятия решения.'),
    }
    for kind,terms in hits_by_type.items():
        if kind not in definitions: continue
        title,explanation=definitions[kind]
        for term in terms:
            for match in re.finditer(re.escape(term),normalized):
                if len(term)<=2 and ((match.start()>0 and normalized[match.start()-1].isalnum()) or (match.end()<len(normalized) and normalized[match.end()].isalnum())):
                    continue
                word_start,word_end=match.start(),match.end()
                while word_start>0 and (normalized[word_start-1].isalnum() or normalized[word_start-1]=='_'): word_start-=1
                while word_end<len(normalized) and (normalized[word_end].isalnum() or normalized[word_end]=='_'): word_end+=1
                span=_source_span(word_start,word_end,starts,ends,utf16)
                if span: found.append({'start':span[0],'end':span[1],'text':source.encode('utf-16-le')[2*span[0]:2*span[1]].decode('utf-16-le','ignore'),'feature_type':kind,'explanation':explanation,'label':title})
    for amount in amounts:
        span=_source_span(amount['start'],amount['end'],starts,ends,utf16)
        if span:
            kind='deposit' if amount['role']=='required_contribution' else 'payout' if amount['role']=='promised_return' else 'recruitment' if amount['role']=='referral_reward' else 'deposit' if amount['role']=='package_cost' else 'payout'
            label,explanation=definitions[kind]
            found.append({'start':span[0],'end':span[1],'text':amount['surface'],'feature_type':kind,'explanation':explanation,'label':label})
    if period:
        span=_source_span(period['start'],period['end'],starts,ends,utf16)
        if span: found.append({'start':span[0],'end':span[1],'text':source.encode('utf-16-le')[2*span[0]:2*span[1]].decode('utf-16-le','ignore'),'feature_type':'period','explanation':'Здесь указан срок или периодичность выплаты.','label':'Срок выплаты'})
    # Keep exact ranges. A downstream renderer resolves overlaps by longest span and precedence.
    uniq={(x['start'],x['end'],x['feature_type']):x for x in found}
    return sorted(uniq.values(),key=lambda x:(x['start'],x['end'],x['feature_type']))


def analyze(text: str) -> dict[str,Any]:
    t,source_starts,source_ends=normalize_with_map(text)
    amounts=money_mentions(t)
    warning=hits(t,WARNING)
    safe=hits(t,SAFETY)
    dep=hits(t,DEPOSIT)
    ret=hits(t,RETURN)
    guar=hits(t,GUARANTEE)
    ref=hits(t,REFERRAL)
    personal=hits(t,PERSONAL)
    urgent=hits(t,URGENCY)
    task=hits(t,TASKS)
    screen=hits(t,SCREENSHOT)
    uncertain=hits(t,UNCERTAIN)
    no_guarantee=bool(re.search(r'(?:не гарант|гарантии нет|кепілдік жоқ|kepildik zhok|нет гаранти)',t))
    if no_guarantee: guar=[]
    # Negative financial contexts override generic deposit/transfer keywords.
    is_safe_context=bool(safe) and not bool(task)
    is_warning=bool(warning)
    deposit_negated=bool(re.search(r'(?:без\s+(?:первоначальн\w*\s+)?(?:взнос\w*|вклад\w*|инвестиц\w*)|(?:взнос|вклад|салым|жарна)\w*\s+(?:не\s+нуж\w*|не\s+требу\w*|жоқ|қажет\s+емес)|не\s+требу\w*\s+(?:взнос|вклад|салым|жарна)|инвестици\w*\s+не\s+требу\w*)',t))
    dep_bool=bool(dep) and not deposit_negated and not is_safe_context
    negated_return=bool(re.search(r'(?:доход|прибыл\w*|выплат\w*|табыс\w*)\s+(?:не\s+(?:гарантир|обеща|предусмотр)|не гарантирован)|(?:не обеща|не гарантиру)\w*\s+(?:никак\s+)?(?:доход|прибыл|выплат)',t))
    if negated_return: ret=[]
    return_bool=bool(ret)
    # Keep monetary roles separate: a deposit requirement is a textual condition,
    # not a side effect of recognizing a KZT amount.
    _role_money_mentions(t,amounts,dep_bool,return_bool,bool(ref))
    deposit,payout=get_money_roles(t,amounts,dep_bool,return_bool)
    referral_count=extract_ref_count(t) if ref else None
    period_info=extract_period_info(t)
    period=period_info['value'] if period_info and period_info['unit']=='day' else None
    points=0
    evidence=[]
    def add(indicator:str,score:int,match:list[str]|None=None):
        nonlocal points
        points+=score
        evidence.append({'indicator':indicator,'points':score,'matched':(match or [])[:3]})

    if not is_warning and not is_safe_context:
        if dep_bool: add('Упомянут платёж/взнос как условие',16,dep)
        if deposit and payout and payout>=deposit*1.5:
            add('Предлагаемая выплата заметно больше внесённой суммы',24,[f'{deposit} ₸ → {payout} ₸'])
        if guar and return_bool: add('Утверждение о гарантированной выплате',18,guar)
        if ref and ret:
            add('Бонус/выплата зависит от приглашений',20 if dep_bool else 16,ref)
        if personal and dep_bool: add('Перевод на личную карту в контексте вложений',12,personal)
        if urgent and dep_bool: add('Ограничение по времени для денежного предложения',10,urgent)
        if task and dep_bool and ret: add('Выплата за задания с предварительным взносом',18,task)
        if screen and ret and not (deposit and payout):add('Скриншот/утверждение о выплате без достаточного контекста',12,screen)
        if uncertain and (dep_bool or bool(ref) or (bool(screen) and ret)):
            add('Недостающие сведения об условиях или источнике средств',15,uncertain)
    else:
        evidence.append({'indicator':'Контекст предупреждения или обычной операции; автоматический скоринг подавлен',
                         'points':0,'matched':(warning or safe)[:3]})
    risk='high' if points>=58 else 'medium' if points>=25 else 'low'
    kzhint=bool(re.search(r'(?:₸|\bтг\b|\bтенге\b|\bтеңге\b|\btg\b|\bkzt\b|kaspi)',t))
    # Attach optional role-aware financial spans without altering legacy fields.
    for mention in amounts:
        mention['source_span']=_source_span(mention['start'],mention['end'],source_starts,source_ends,_utf16_offsets(text))
    fingerprint={
      'deposit_kzt':deposit,
      'promised_payout_kzt':payout,
      'payout_multiplier':round(payout/deposit,2) if deposit and payout and deposit>0 else None,
      'referral_count':referral_count,
      'period_days':period,
      'needs_deposit':dep_bool,
      'has_return_claim':return_bool,
      'has_guarantee_claim':bool(guar) and not bool(warning),
      'has_recruitment':bool(ref),
      'has_individual_transfer':bool(personal),
      'has_tasks_upfront':bool(task) and dep_bool,
      'has_urgency':bool(urgent),
      'is_warning':is_warning,
      'is_benign_context':is_safe_context,
    }
    # Region is an indicator, not a fact that the sender is physically in Kazakhstan.
    spans=_evidence_spans(text,t,source_starts,source_ends,
        {'deposit':dep if dep_bool else [],'payout':ret,'recruitment':ref,'guarantee':guar,'pressure':urgent},amounts,period_info)
    # Also expose percentage claims as typed evidence; they are not monetary amounts.
    percent_terms=[]
    for match in PERCENT_RE.finditer(t):
        span=_source_span(match.start(),match.end(),source_starts,source_ends,_utf16_offsets(text))
        if span:
            val=lambda x: float((x or '0').replace(',','.'))
            percent_terms.append({'min':min(val(match.group('low')),val(match.group('high') or match.group('low'))),
                                  'max':max(val(match.group('low')),val(match.group('high') or match.group('low'))),
                                  'unit':'percent','surface':text.encode('utf-16-le')[2*span[0]:2*span[1]].decode('utf-16-le','ignore'),
                                  'start':span[0],'end':span[1],'role':'referral_reward' if bool(ref) and any(w in t[max(0,match.start()-60):match.end()+60] for w in ('реферал','бонус','сыйақы','приглаш','шақыр')) else 'promised_return'})
            label='Вознаграждение за приглашение' if percent_terms[-1]['role']=='referral_reward' else 'Обещанная доходность'
            spans.append({'start':span[0],'end':span[1],'text':percent_terms[-1]['surface'],'feature_type':'recruitment' if percent_terms[-1]['role']=='referral_reward' else 'payout','explanation':'Процент указан в исходном тексте; его роль определяется по ближайшему финансовому контексту.','label':label})
    return {
      'risk_label':risk,'risk_points':min(100,points),'evidence':evidence,
      'risk_breakdown':{'factors':evidence,'uncapped_points':points,'capped':points>100,
                        'method':'Сумма баллов сработавших правил, ограниченная 100.'},
      'amount_mentions':amounts,'financial_terms':{'money':amounts,'percentages':percent_terms,'period':period_info},
      'evidence_spans':sorted({(s['start'],s['end'],s['feature_type']):s for s in spans}.values(),key=lambda s:(s['start'],s['end'])),
      'fingerprint':fingerprint,
      'kz_relevance_indicator':'possible' if kzhint else 'unverified',
      'review_required':risk in ('medium','high'),
      'disclaimer':'Preliminary indicators only. No accusation, identification or legal determination.'
    }


def _exact_or_decay(a:int|None,b:int|None,weight:float)->tuple[float,float]:
    if a is None and b is None:return 0.,0.
    if a is None or b is None:return 0.,weight
    if a==b:return weight,weight
    ratio=min(a,b)/max(a,b)
    return weight*(0.12+0.48*ratio),weight


def _typed_amount(analysis: dict[str, Any], roles: tuple[str, ...]) -> dict[str, Any] | None:
    terms=analysis.get('financial_terms',{}).get('money',[])
    return next((m for m in terms if m.get('role') in roles and m.get('currency')),None)


def _compare_money_values(av: dict | None,bv: dict | None,weight:float) -> tuple[float,float,str,Any,Any,str]:
    if av is None and bv is None:return 0.,0.,'unknown',None,None,'Недостаточно данных в обоих текстах.'
    if av is None:return 0.,weight,'missing_left',None,bv,'Значение не извлечено из материала A.'
    if bv is None:return 0.,weight,'missing_right',av,None,'Значение не извлечено из материала B.'
    avalue={'min':av['min'],'max':av['max'],'currency':av['currency'],'role':av['role']}
    bvalue={'min':bv['min'],'max':bv['max'],'currency':bv['currency'],'role':bv['role']}
    if av['currency'] != bv['currency'] or av['role'] != bv['role']:
        return 0.,weight,'conflict',avalue,bvalue,'Валюта или роль сумм различается; пересчёт не выполняется.'
    alo,ahi=av['min'],av['max'];blo,bhi=bv['min'],bv['max']
    if alo==blo and ahi==bhi:return weight,weight,'exact_match',avalue,bvalue,'Диапазоны совпадают в одной валюте.'
    if ahi < blo or bhi < alo:
        distance=max(alo,blo)-min(ahi,bhi)
        scale=max(alo,blo,1.)
        fraction=max(0.,min(1.,0.12+0.48*(1-distance/scale)))
        raw=weight*fraction
        return raw,weight,'partial_match' if raw else 'conflict',avalue,bvalue,'Суммы различаются; учтена относительная близость без конвертации.'
    return weight*0.6,weight,'partial_match',avalue,bvalue,'Диапазоны пересекаются в одной валюте.'


def compare(left:dict[str,Any],right:dict[str,Any])->dict[str,Any]:
    """Similarity of FINANCIAL MODELS, not evidence of a shared organizer."""
    a=left['fingerprint'];b=right['fingerprint']
    # Do not compare unrelated low-risk receipts/warnings as pyramid mechanisms.
    if a['is_warning'] or b['is_warning'] or a['is_benign_context'] or b['is_benign_context']:
        return {'similarity':0.,'is_similar':False,'shared_features':[],'feature_comparison':[],
                'caution':'Предупреждения и сообщения с низким риском не объединяются с финансовыми механизмами пирамид.'}
    weights={'needs_deposit':0.12,'has_return_claim':0.12,'has_guarantee_claim':0.07,
             'has_recruitment':0.12,'has_individual_transfer':0.09,
             'has_tasks_upfront':0.09,'has_urgency':0.04}
    score=den=0.
    features=[]; rows=[]
    def row(key: str,label: str,av: Any,bv: Any,w: float,raw: float,included: float,status: str,explanation: str):
        rows.append({'feature':key,'label':label,'left_value':av,'right_value':bv,'status':status,
                     'weight':w,'included_weight':included,'raw_contribution':round(raw,8),
                     'normalized_contribution':0.0,'explanation':explanation})
    for key,w in weights.items():
        # Comparing two absent flags tells us almost nothing; ignore both false.
        if not a[key] and not b[key]:
            row(key,key,a[key],b[key],w,0.,0.,'unknown','Признак отсутствует в обоих текстах и не повышает сходство.')
            continue
        den+=w
        if a[key] and b[key]:
            score+=w;features.append(key);row(key,key,True,True,w,w,w,'exact_match','Признак обнаружен в обоих текстах.')
        else:
            row(key,key,a[key],b[key],w,0.,w,'conflict','Признак обнаружен только в одном из текстов.')
    numeric_labels={'deposit_kzt':'Взнос, ₸','promised_payout_kzt':'Обещанная выплата, ₸','referral_count':'Число приглашённых','period_days':'Срок, дней'}
    typed={
      'deposit_kzt':(_typed_amount(left,('required_contribution','package_cost')),_typed_amount(right,('required_contribution','package_cost'))),
      'promised_payout_kzt':(_typed_amount(left,('promised_return',)),_typed_amount(right,('promised_return',))),
    }
    for key,w in [('deposit_kzt',0.14),('promised_payout_kzt',0.14),('referral_count',0.09),('period_days',0.04)]:
        if key in typed and (typed[key][0] is not None or typed[key][1] is not None):
            s,d,status,av,bv,explanation=_compare_money_values(*typed[key],w)
        else:
            av,bv=a[key],b[key]
            s,d=_exact_or_decay(av,bv,w)
            if av is None and bv is None: status='unknown'; explanation='Недостаточно данных в обоих текстах.'
            elif av is None: status='missing_left'; explanation='Значение не извлечено из материала A.'
            elif bv is None: status='missing_right'; explanation='Значение не извлечено из материала B.'
            elif av==bv: status='exact_match'; explanation='Извлечённые значения совпадают.'
            elif s>0: status='partial_match'; explanation='Значения различаются; учтена их относительная близость.'
            else: status='conflict'; explanation='Извлечённые значения различаются.'
        score+=s;den+=d
        if av is not None and av==bv:features.append(f'{key}={av}')
        row(key,numeric_labels[key],av,bv,w,s,d,status,explanation)
    ma=a['payout_multiplier'];mb=b['payout_multiplier']
    if ma is not None or mb is not None:
        den+=0.13
        if ma and mb:
            s=abs(ma-mb)
            raw=0.13 * (1 if s<0.01 else max(0,1-s/max(1.,ma,mb)))
            score+=raw
            if s<0.01:features.append('same_multiplier')
            status='exact_match' if s<0.01 else 'partial_match' if raw else 'conflict'
            explanation='Коэффициенты выплаты совпадают.' if s<0.01 else 'Сопоставлена относительная разница коэффициентов.' if raw else 'Коэффициенты существенно различаются.'
        elif ma is None: raw=0.;status='missing_left';explanation='Не хватает коэффициента из материала A.'
        else: raw=0.;status='missing_right';explanation='Не хватает коэффициента из материала B.'
        row('payout_multiplier','Коэффициент выплаты',ma,mb,0.13,raw,0.13,status,explanation)
    similarity=round(score/den,4) if den else 0.
    for item in rows: item['normalized_contribution']=round(item['raw_contribution']/den,8) if den else 0.0
    return {'similarity':similarity,'is_similar':similarity>=0.80,
            'shared_features':features,'feature_comparison':rows,
            'caution':'Сходство условий не доказывает общего владельца, единую схему, преступление или личность участников.'}


def load_records(path:Path|str=DEFAULT_DATA)->list[dict[str,Any]]:
    p=Path(path)
    result=[]
    with p.open('r',encoding='utf-8') as f:
        for number,line in enumerate(f,1):
            if not line.strip():continue
            try:result.append(json.loads(line))
            except json.JSONDecodeError as exc:raise ValueError(f'{p}:{number}: {exc}') from exc
    return result


def validate_records(records:list[dict])->dict[str,Any]:
    issues=[];ids=set();texts=set();groups=defaultdict(set)
    expected_fields={'id','text','risk_label','mechanism_id','split','language','modality','source_type','provenance','expected'}
    for i,r in enumerate(records,1):
        miss=expected_fields-set(r)
        if miss:issues.append(f'line {i}: missing {sorted(miss)}')
        if r.get('id') in ids:issues.append(f'line {i}: duplicate ID')
        ids.add(r.get('id'))
        if r.get('text') in texts:issues.append(f'line {i}: duplicate text')
        texts.add(r.get('text'))
        if r.get('provenance')!='fully_synthetic':issues.append(f'line {i}: unsupported provenance')
        if r.get('risk_label') not in ('low','medium','high'):issues.append(f'line {i}: invalid label')
        if r.get('split') not in ('train','validation','test'):issues.append(f'line {i}: invalid split')
        groups[r.get('mechanism_id')].add(r.get('split'))
    for group, splits in groups.items():
        if len(splits)>1:issues.append(f'mechanism {group} leaks across splits: {splits}')
    counts={f'{a}/{b}':n for (a,b),n in sorted(Counter((r['split'],r['risk_label']) for r in records).items())}
    return {'valid':not issues,'records':len(records),'scenarios':len(groups),'distribution':counts,
            'languages':dict(Counter(r.get('language') for r in records)),
            'modalities':dict(Counter(r.get('modality') for r in records)),
            'issues':issues[:25]}


def report_scores(rows:list[dict],binary:bool=False)->dict:
    """Three-class confusion table + high-risk precision/recall/FPR.
    Uncertain/medium is not a legal finding. This is synthetic-only testing.
    """
    labels=['low','medium','high']
    cm={gold:{pred:0 for pred in labels} for gold in labels}
    for r in rows:
        gold=r['risk_label'];pred=analyze(r['text'])['risk_label']
        cm[gold][pred]+=1
    tp=cm['high']['high'];fn=sum(cm['high'][p] for p in labels if p!='high')
    fp=sum(cm[g]['high'] for g in labels if g!='high')
    tn=sum(cm[g][p] for g in labels if g!='high' for p in labels if p!='high')
    precision=tp/(tp+fp) if tp+fp else None
    recall=tp/(tp+fn) if tp+fn else None
    fpr=fp/(fp+tn) if fp+tn else None
    accuracy=sum(cm[l][l] for l in labels)/len(rows) if rows else None
    return {'count':len(rows),'confusion_matrix_gold_rows':cm,'accuracy_3class':accuracy,
            'high_risk_precision':precision,'high_risk_recall':recall,'high_risk_false_positive_rate':fpr,
            'note':'Synthetic, template-based evaluation only. NOT an estimate of performance on real Telegram/WhatsApp data.'}


def matching_metrics(rows:list[dict],seed:int=42,n_negative:int=750)->dict:
    rng=random.Random(seed)
    by_group=defaultdict(list)
    for r in rows:
        if r['risk_label'] in ('high','medium'):by_group[r['mechanism_id']].append(r)
    analysis={r['id']:analyze(r['text']) for r in rows}
    positives=[]
    for group in by_group.values():
        for i in range(len(group)):
            for j in range(i+1,len(group)):
                positives.append((group[i],group[j]))
    negatives=[];ids=[i for i,r in enumerate(rows) if r['risk_label'] in ('high','medium')]
    seen=set(); attempts=0
    while len(negatives)<n_negative and attempts<n_negative*50:
        attempts+=1
        a,b=rng.sample(ids,2)
        if a>b:a,b=b,a
        if (a,b) in seen or rows[a]['mechanism_id']==rows[b]['mechanism_id']:continue
        seen.add((a,b));negatives.append((rows[a],rows[b]))
    tp=sum(compare(analysis[a['id']],analysis[b['id']])['is_similar'] for a,b in positives)
    fp=sum(compare(analysis[a['id']],analysis[b['id']])['is_similar'] for a,b in negatives)
    return {'positive_pairs':len(positives),'negative_pairs':len(negatives),
            'pair_precision':tp/(tp+fp) if tp+fp else None,
            'pair_recall':tp/len(positives) if positives else None,
            'pair_false_positive_rate':fp/len(negatives) if negatives else None,
            'threshold':0.80,
            'note':'Pairs cover high/medium fictional financial offers only; deliberately excludes everyday benign purchases and warnings from positive-match tasks. Mechanism ID is NOT proof of linked real organizers.'}


def get_record(rows:list[dict],record_id:str)->dict:
    for r in rows:
        if r['id']==record_id:return r
    raise KeyError(f'No such record ID: {record_id}')


def pretty(obj:Any)->None:
    print(json.dumps(obj,ensure_ascii=False,indent=2))


def main(argv:list[str]|None=None)->int:
    p=argparse.ArgumentParser(description='SafeNet KZ / Pyramid DNA: dataset + analysis + evaluation')
    p.add_argument('--data',type=Path,default=DEFAULT_DATA,help='JSONL dataset, default in script folder')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('validate');sub.add_parser('stats');sub.add_parser('demo')
    an=sub.add_parser('analyze');an.add_argument('--text');an.add_argument('--record-id')
    ng=sub.add_parser('neighbors');ng.add_argument('--record-id',required=True);ng.add_argument('--top',type=int,default=5)
    ev=sub.add_parser('evaluate');ev.add_argument('--split',choices=['train','validation','test'],default='test')
    ba=sub.add_parser('batch');ba.add_argument('--split',choices=['train','validation','test','all'],default='all');
    ba.add_argument('--output',type=Path,required=True)
    args=p.parse_args(argv)
    rows=load_records(args.data)
    if args.command in ('validate','stats'):
        pretty(validate_records(rows));return 0 if validate_records(rows)['valid'] else 2
    if args.command=='analyze':
        if bool(args.text)==bool(args.record_id):p.error('Provide exactly one of --text or --record-id')
        record=get_record(rows,args.record_id) if args.record_id else None
        result=analyze(record['text'] if record else args.text)
        if record:result['record_metadata']={k:record[k] for k in ('id','split','risk_label','language','archetype')}
        pretty(result);return 0
    if args.command=='neighbors':
        anchor=get_record(rows,args.record_id)
        ar=analyze(anchor['text']);found=[]
        for other in rows:
            if other['id']==anchor['id']:continue
            item=compare(ar,analyze(other['text']))
            found.append({'id':other['id'],'similarity':item['similarity'],
                          'is_similar':item['is_similar'],'shared_features':item['shared_features'],
                          'text':other['text'][:180]})
        found.sort(key=lambda r:r['similarity'],reverse=True)
        pretty({'anchor':args.record_id,'neighbors':found[:args.top]});return 0
    if args.command=='evaluate':
        subset=[r for r in rows if r['split']==args.split]
        pretty({'split':args.split,'risk_classification':report_scores(subset),
                'mechanism_similarity':matching_metrics(subset)});return 0
    if args.command=='batch':
        subset=[r for r in rows if args.split=='all' or r['split']==args.split]
        with args.output.open('w',encoding='utf-8') as f:
            for r in subset:
                prediction=analyze(r['text'])
                f.write(json.dumps({'id':r['id'],'source_type':r['source_type'],
                                    'provenance':r['provenance'],'prediction':prediction},ensure_ascii=False)+'\n')
        pretty({'saved':str(args.output),'records':len(subset)});return 0
    if args.command=='demo':
        cases=[
          'В чате требуют взнос 5 000 ₸, обещают 10 000 ₸ через 1 день, просят пригласить 2 участников.',
          'Чатта 5 000 теңге жарна сұрайды, 1 күнде 10 000 теңге төлем уәде етеді, 2 адам шақыру керек.',
          'Kaspi перевод 5 000 ₸ — это оплата товара, никакой доход не обещается.'
        ]
        analyzed=[analyze(x) for x in cases]
        pretty({'examples':[{'text':x,'analysis':a} for x,a in zip(cases,analyzed)],
                'comparison_1_2':compare(analyzed[0],analyzed[1]),
                'comparison_1_3':compare(analyzed[0],analyzed[2])})
        return 0
    return 1

if __name__=='__main__':sys.exit(main())
