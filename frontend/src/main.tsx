import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  api,
  download,
  feature,
  labels,
  riskLabel,
  value,
  type Analysis,
  type CaseItem,
  type Comparison,
  type Evaluation,
  type Neighbor,
  type RecordItem,
  type EvidenceSpan,
  type BenchmarkResult,
  type PublicChallengeResult,
  type ConversationBenchmarkResult,
  type OcrBenchmarkResult,
  type ConversationEvidence,
  type ConversationMechanism,
  type ConversationMessage,
  type ConversationPreview,
  type ConversationResult,
} from "./api";
import { readUtf8TextFile } from "./textImport";
import {
  previewOcrImage,
  recognizeRuKz,
  validateOcrImage,
  type OcrCrop,
  type OcrProgress,
  type OcrQuality,
} from "./ocrClient";
import "./style.css";

const sections = [
  {
    path: "/",
    label: "Проверка",
    description: "Разобрать финансовое предложение",
    icon: "scan",
  },
  {
    path: "/compare",
    label: "Сравнение",
    description: "Сопоставить два механизма",
    icon: "compare",
  },
  {
    path: "/materials",
    label: "Материалы",
    description: "Учебные примеры и сохранённые дела",
    icon: "folder",
  },
  {
    path: "/quality",
    label: "Качество",
    description: "Результаты тестирования правил",
    icon: "chart",
  },
  {
    path: "/method",
    label: "Методика",
    description: "Принципы работы и ограничения",
    icon: "book",
  },
];
const navigationSections = sections.filter(
  (section) => section.path !== "/quality",
);
const disclaimer =
  "Предварительная оценка по правилам. Не юридическое заключение. Сходство финансовых условий не устанавливает общего организатора.";
const origins: Record<string, string> = {
  public: "Публичная публикация",
  voluntary: "Добровольно предоставленный обезличенный материал",
  synthetic: "Синтетический пример",
  other: "Другое разрешённое происхождение",
};
const statuses: Record<string, string> = {
  new: "Новое",
  reviewing: "На проверке",
  closed: "Закрыто",
};

type IconName = string;
function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  const paths: Record<string, ReactNode> = {
    scan: (
      <>
        <path d="M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4M8 9h8M8 13h6M8 17h3" />
      </>
    ),
    compare: (
      <>
        <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
      </>
    ),
    folder: <path d="M3 6h7l2 3h9v11H3V6Z" />,
    chart: (
      <>
        <path d="M4 3v17h17M9 16V9m5 7V5m5 11v-5" />
      </>
    ),
    book: (
      <>
        <path d="M12 6v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2V4Z" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l4 4v14H3V3h2Z" />
        <path d="M7 3v6h10V3M7 21v-8h10v8" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-11v1" />
      </>
    ),
    plus: <path d="M12 4v16M4 12h16" />,
    chevron: <path d="m8 4 8 8-8 8" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}
function Risk({ risk }: { risk: string }) {
  return (
    <span className={`risk-badge ${risk}`}>
      <span />
      {riskLabel[risk] ?? risk}
    </span>
  );
}
function factorCountLabel(count: number) {
  const mod10 = count % 10,
    mod100 = count % 100;
  return `${count} ${mod10 === 1 && mod100 !== 11 ? "фактор" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "фактора" : "факторов"}`;
}
function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <Icon name="info" />
      <span>{error.message}</span>
      {retry && <button onClick={retry}>Повторить</button>}
    </div>
  );
}
function Empty({
  title,
  children,
  icon = "folder",
}: {
  title: string;
  children: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
function Modal({
  open,
  close,
  title,
  children,
  drawer = false,
}: {
  open: boolean;
  close: () => void;
  title: string;
  children: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() =>
        dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus(),
      );
    } else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={drawer ? "modal drawer" : "modal"}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть окно"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const fieldEvidence: Record<string, EvidenceSpan["feature_type"]> = {
  deposit_kzt: "deposit",
  needs_deposit: "deposit",
  promised_payout_kzt: "payout",
  has_return_claim: "payout",
  payout_multiplier: "payout",
  period_days: "period",
  referral_count: "recruitment",
  has_recruitment: "recruitment",
  has_guarantee_claim: "guarantee",
  has_urgency: "pressure",
};
function confirmedFeature(analysis: Analysis, type: string): boolean {
  const fp = analysis.fingerprint;
  switch (type) {
    case "deposit":
      return typeof fp.deposit_kzt === "number" || fp.needs_deposit === true;
    case "payout":
      return (
        typeof fp.promised_payout_kzt === "number" ||
        fp.has_return_claim === true
      );
    case "period":
      return typeof fp.period_days === "number";
    case "recruitment":
      return (
        typeof fp.referral_count === "number" || fp.has_recruitment === true
      );
    case "guarantee":
      return fp.has_guarantee_claim === true;
    case "pressure":
      return fp.has_urgency === true;
    default:
      return false;
  }
}
function confirmedSpans(analysis?: Analysis): EvidenceSpan[] {
  return (analysis?.evidence_spans ?? []).filter(
    (span) => analysis && confirmedFeature(analysis, span.feature_type),
  );
}
function FinancialHero({
  analysis,
  title,
  activeFeature,
  onFeatureSelect,
}: {
  analysis: Analysis;
  title?: string;
  activeFeature?: string;
  onFeatureSelect?: (feature: string) => void;
}) {
  const fp = analysis.fingerprint;
  const deposit = fp.deposit_kzt,
    payout = fp.promised_payout_kzt,
    multiplier = fp.payout_multiplier,
    period = fp.period_days,
    referrals = fp.referral_count;
  const hasDeposit = typeof deposit === "number",
    hasPayout = typeof payout === "number";
  return (
    <div className="financial-hero">
      <div className="financial-hero-heading">
        <span>{title ?? "Финансовый механизм"}</span>
        <span>Извлечено из сообщения</span>
      </div>
      <div className="money-flow">
        {hasDeposit && (
          <button
            type="button"
            className={activeFeature === "deposit" ? "trace-active" : ""}
            onClick={() => onFeatureSelect?.("deposit")}
          >
            <small>Взнос</small>
            <strong>{value(deposit, "deposit_kzt")}</strong>
          </button>
        )}
        {hasDeposit && hasPayout && (
          <span className="money-arrow" aria-label="переходит в">
            →
          </span>
        )}
        {hasPayout && (
          <button
            type="button"
            className={activeFeature === "payout" ? "trace-active" : ""}
            onClick={() => onFeatureSelect?.("payout")}
          >
            <small>Обещанная выплата</small>
            <strong>{value(payout, "promised_payout_kzt")}</strong>
          </button>
        )}
        {!hasDeposit && !hasPayout && (
          <p>Взнос и выплата не извлечены из текста.</p>
        )}
      </div>
      <div className="money-context">
        {typeof multiplier === "number" && (
          <span>
            ×{multiplier.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
          </span>
        )}
        {typeof period === "number" && (
          <button
            type="button"
            className={activeFeature === "period" ? "trace-active" : ""}
            onClick={() => onFeatureSelect?.("period")}
          >
            {period.toLocaleString("ru-RU")} дн.
          </button>
        )}
        {typeof referrals === "number" && (
          <button
            type="button"
            className={activeFeature === "recruitment" ? "trace-active" : ""}
            onClick={() => onFeatureSelect?.("recruitment")}
          >
            {referrals.toLocaleString("ru-RU")} приглашённых
          </button>
        )}
      </div>
    </div>
  );
}
function FinancialModel({
  analysis,
  compact = false,
  activeFeature,
  onFeatureSelect,
}: {
  analysis: Analysis;
  compact?: boolean;
  activeFeature?: string;
  onFeatureSelect?: (feature: string) => void;
}) {
  const a = analysis;
  const row = ([key, label]: [string, string]) => (
    <div
      key={key}
      className={fieldEvidence[key] === activeFeature ? "trace-active" : ""}
    >
      <dt>{label}</dt>
      <dd>
        {fieldEvidence[key] &&
        a.fingerprint[key] != null &&
        a.fingerprint[key] !== false &&
        confirmedSpans(a).some((s) => s.feature_type === fieldEvidence[key]) &&
        onFeatureSelect ? (
          <button
            type="button"
            className="model-value-button"
            onClick={() => onFeatureSelect(fieldEvidence[key])}
          >
            {value(a.fingerprint[key], key)}
          </button>
        ) : (
          value(a.fingerprint[key], key)
        )}
      </dd>
    </div>
  );
  return (
    <div className={compact ? "financial-model compact" : "financial-model"}>
      <dl>{Object.entries(labels).slice(0, 5).map(row)}</dl>
      <details>
        <summary>
          Все признаки финансового механизма <span>+</span>
        </summary>
        <dl>{Object.entries(labels).slice(5).map(row)}</dl>
      </details>
    </div>
  );
}
function factorFeatures(analysis: Analysis, matched: string[]): string[] {
  const normalized = matched.map((m) =>
    m.toLocaleLowerCase().replace(/\s/g, ""),
  );
  const found = (analysis.evidence_spans ?? [])
    .filter((span) =>
      normalized.some((m) => {
        const s = span.text.toLocaleLowerCase().replace(/\s/g, "");
        return s.length >= 4 && (m.includes(s) || s.includes(m));
      }),
    )
    .map((span) => span.feature_type);
  for (const [field, type] of [
    ["deposit_kzt", "deposit"],
    ["promised_payout_kzt", "payout"],
  ] as const) {
    const n = analysis.fingerprint[field];
    if (
      typeof n === "number" &&
      normalized.some((m) => m.replace(/\D/g, "").includes(String(n)))
    )
      found.push(type);
  }
  return [...new Set(found)];
}
function Evidence({
  analysis,
  activeFeature,
}: {
  analysis: Analysis;
  activeFeature?: string;
}) {
  const factors = analysis.risk_breakdown?.factors ?? analysis.evidence ?? [];
  return (
    <div className="evidence-list">
      {factors.length ? (
        factors.map((e, i) => (
          <div
            className={`evidence-item ${activeFeature && factorFeatures(analysis, e.matched).includes(activeFeature) ? "trace-active" : ""}`}
            key={i}
          >
            <span className="evidence-index">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="evidence-copy">
              <strong>{e.indicator}</strong>
              {e.matched.length > 0 && (
                <p>
                  {e.matched.map((m, j) => (
                    <q key={j}>{m}</q>
                  ))}
                </p>
              )}
            </div>
            <span className="rule-points">+{e.points}</span>
          </div>
        ))
      ) : (
        <p className="muted">
          Правила риска не сработали. Это не подтверждает безопасность
          предложения.
        </p>
      )}
      {analysis.risk_breakdown?.capped && (
        <p className="score-note">
          Сумма вкладов правил ограничена 100 баллами.
        </p>
      )}
    </div>
  );
}
function RiskGauge({ analysis }: { analysis: Analysis }) {
  const circumference = Math.PI * 42;
  const color =
    analysis.risk_label === "high"
      ? "#a54c32"
      : analysis.risk_label === "medium"
        ? "#a18145"
        : "#6e8060";
  return (
    <div
      className={`risk-gauge ${analysis.risk_label}`}
      role="img"
      aria-label={`${riskLabel[analysis.risk_label]}, ${analysis.risk_points} из 100 баллов по действующим правилам`}
    >
      <svg viewBox="0 0 100 58" aria-hidden="true">
        <path className="gauge-track" d="M8 52 A42 42 0 0 1 92 52" />
        <path
          d="M8 52 A42 42 0 0 1 92 52"
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - analysis.risk_points / 100)}
        />
      </svg>
      <div className="gauge-reading">
        <b>{analysis.risk_points}</b>
        <span>{riskLabel[analysis.risk_label]}</span>
        <small>баллы правил · не вероятность</small>
      </div>
    </div>
  );
}
function AnalysisSummary({ analysis }: { analysis: Analysis }) {
  return (
    <>
      <div className={`assessment ${analysis.risk_label}`}>
        <div>
          <Risk risk={analysis.risk_label} />
          <h3>
            {analysis.risk_label === "high"
              ? "Есть сочетание тревожных признаков"
              : analysis.risk_label === "medium"
                ? "Нужно уточнить условия"
                : "Существенных сочетаний не выявлено"}
          </h3>
          <p>
            {analysis.review_required
              ? "Перед решением требуется проверка специалиста."
              : "Проверьте контекст и сведения об источнике."}
          </p>
        </div>
        <RiskGauge analysis={analysis} />
      </div>
      <p className="score-note">
        Оценка признаков по действующим правилам; она не означает вероятность
        преступления.
      </p>
    </>
  );
}

const evidencePriority: Record<string, number> = {
  deposit: 0,
  payout: 1,
  period: 2,
  recruitment: 3,
  guarantee: 4,
  pressure: 5,
};
const contextStatusLabel: Record<string, string> = {
  claim: "Подтверждённое условие",
  question: "Вопрос, не подтверждение",
  quoted: "Цитата",
  warning: "Предупреждение",
  negated: "Отрицание",
  unverified: "Непроверенное утверждение",
  neutral: "Нейтральный контекст",
};
function highlightedText(
  text: string,
  spans: EvidenceSpan[],
  activeFeature?: string,
) {
  const usable = [...spans]
    .filter(
      (s) =>
        Number.isInteger(s.start) &&
        Number.isInteger(s.end) &&
        s.start >= 0 &&
        s.end > s.start &&
        s.end <= text.length &&
        text.slice(s.start, s.end) === s.text,
    )
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - b.start - (a.end - a.start) ||
        (evidencePriority[a.feature_type] ?? 9) -
          (evidencePriority[b.feature_type] ?? 9),
    );
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const span of usable) {
    if (span.start < cursor) continue;
    if (span.start > cursor)
      parts.push(
        <span key={`text-${cursor}`}>{text.slice(cursor, span.start)}</span>,
      );
    const status = span.context_status ?? "claim";
    parts.push(
      <mark
        key={`mark-${span.start}-${span.end}-${span.feature_type}`}
        className={`evidence-mark ${span.feature_type} context-${status} ${activeFeature === span.feature_type ? "trace-active" : ""}`}
        title={`${span.explanation} ${contextStatusLabel[status] ?? ""}`.trim()}
      >
        {text.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < text.length)
    parts.push(<span key={`text-${cursor}`}>{text.slice(cursor)}</span>);
  return parts.length ? parts : text;
}
function EvidenceEditor({
  text,
  onChange,
  label,
  placeholder,
  className,
  spans = [],
  active = false,
  activeFeature,
  onFeatureSelect,
  onKeyDown,
  id,
}: {
  text: string;
  onChange: (text: string) => void;
  label: string;
  placeholder?: string;
  className: string;
  spans?: EvidenceSpan[];
  active?: boolean;
  activeFeature?: string;
  onFeatureSelect?: (feature: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  id?: string;
}) {
  const visible = active && spans.length > 0;
  const inputRef = useRef<HTMLTextAreaElement>(null),
    underlayRef = useRef<HTMLDivElement>(null);
  const descriptions = [
    ...new Set(spans.map((s) => `${s.label}: ${s.explanation}`)),
  ];
  return (
    <div
      className={`evidence-editor ${className} ${visible ? "is-highlighted" : ""}`}
    >
      {visible && (
        <div ref={underlayRef} className="evidence-underlay" aria-hidden="true">
          {highlightedText(text, spans, activeFeature)}
        </div>
      )}
      <textarea
        ref={inputRef}
        id={id}
        aria-label={label}
        aria-describedby={
          descriptions.length ? `${id || "evidence"}-descriptions` : undefined
        }
        className={
          className === "analysis-editor" ? "source-editor" : "compare-editor"
        }
        placeholder={placeholder}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onSelect={(e) => {
          if (!visible) return;
          const at = e.currentTarget.selectionStart;
          const match = spans.find((s) => at >= s.start && at <= s.end);
          if (match) onFeatureSelect?.(match.feature_type);
        }}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (underlayRef.current) {
            underlayRef.current.scrollTop = e.currentTarget.scrollTop;
            underlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
      />
      {descriptions.length > 0 && (
        <ul id={`${id || "evidence"}-descriptions`} className="sr-only">
          {descriptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
function TraceLinks({
  analysis,
  activeFeature,
  onFeatureSelect,
}: {
  analysis: Analysis;
  activeFeature?: string;
  onFeatureSelect: (feature: string) => void;
}) {
  const allSpans = confirmedSpans(analysis);
  const groups = [...new Set(allSpans.map((span) => span.feature_type))].map(
    (type) =>
      [type, allSpans.filter((span) => span.feature_type === type)] as const,
  );
  if (!groups.length) return null;
  return (
    <div className="trace-links">
      <p>
        Исходная фраза <span>→</span> извлечённое условие
      </p>
      <div>
        {groups.map(([type, spans]) => (
          <button
            type="button"
            key={type}
            className={activeFeature === type ? "trace-active" : ""}
            onClick={() => onFeatureSelect(type)}
            title={spans?.[0]?.explanation}
          >
            <b>{spans?.[0]?.label}</b>
            <span>{spans?.map((s) => `«${s.text}»`).join(" · ")}</span>
          </button>
        ))}
      </div>
      {activeFeature && groups.some(([type]) => type === activeFeature) && (
        <small>
          {
            groups.find(([type]) => type === activeFeature)?.[1]?.[0]
              ?.explanation
          }
        </small>
      )}
    </div>
  );
}

const ocrStatus: Record<string, string> = {
  "loading tesseract core": "Загружаем OCR-движок",
  "initializing tesseract": "Запускаем OCR-движок",
  "loading language traineddata": "Загружаем модели русского и казахского",
  "initializing api": "Подготавливаем распознавание",
  "recognizing text": "Распознаём текст",
};
const fullCrop: OcrCrop = { left: 0, top: 0, right: 1, bottom: 1 };

function OcrImport({
  onAccept,
  acceptLabel,
}: {
  onAccept: (text: string, name: string) => Promise<void> | void;
  acceptLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [recognized, setRecognized] = useState("");
  const [progress, setProgress] = useState<OcrProgress>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotation, setRotation] = useState(0);
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState<OcrCrop>({ left: 0, top: 0, right: 1, bottom: 1 });
  const [poorConfirmed, setPoorConfirmed] = useState(false);
  const [meta, setMeta] = useState<{
    confidence: number;
    elapsedMs: number;
    normalizations: string[];
    quality: OcrQuality;
    qualityReasons: string[];
    rotation: number;
    retriedOrientations: boolean;
    preparedWidth: number;
    preparedHeight: number;
  }>();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function updatePreview(next: File, nextRotation: number, nextCrop: OcrCrop) {
    const rendered = await previewOcrImage(next, nextRotation, nextCrop);
    setPreview((current) => { if (current) URL.revokeObjectURL(current); return rendered.url; });
  }
  async function choose(next?: File) {
    if (!next) return;
    setError("");
    try {
      await validateOcrImage(next);
      setFile(next);
      setRecognized("");
      setMeta(undefined);
      setProgress(undefined);
      setRotation(0);
      setCrop(fullCrop);
      setPoorConfirmed(false);
      await updatePreview(next, 0, fullCrop);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось прочитать изображение.",
      );
    }
  }
  async function rotate() {
    if (!file || busy) return;
    const nextRotation = (rotation + 90) % 360;
    setRotation(nextRotation);
    setRecognized("");
    setMeta(undefined);
    setPoorConfirmed(false);
    try { await updatePreview(file, nextRotation, crop); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось повернуть изображение."); }
  }
  async function updateCrop(next: OcrCrop) {
    setCrop(next);
    setRecognized("");
    setMeta(undefined);
    setPoorConfirmed(false);
    if (!file || busy) return;
    try { await updatePreview(file, rotation, next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить область."); }
  }
  async function runOcr() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setRecognized("");
    setMeta(undefined);
    setPoorConfirmed(false);
    try {
      const result = await recognizeRuKz(file, setProgress, { rotation, crop });
      if (!result.text.trim())
        throw new Error(
          "Текст не распознан. Попробуйте более чёткий скриншот.",
        );
      setRecognized(result.text);
      setMeta({
        confidence: result.confidence,
        elapsedMs: result.elapsedMs,
        normalizations: result.normalizations,
        quality: result.quality,
        qualityReasons: result.qualityReasons,
        rotation: result.rotation,
        retriedOrientations: result.retriedOrientations,
        preparedWidth: result.preparedWidth,
        preparedHeight: result.preparedHeight,
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "OCR завершился с ошибкой.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`ocr-import ${file ? "has-image" : ""}`}>
      {!file ? (
        <button
          type="button"
          className="plain-button"
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="scan" size={16} />
          Загрузить скриншот
        </button>
      ) : (
        <>
          <div className="ocr-preview">
            <img src={preview} alt="Предпросмотр загруженного скриншота" />
            <div>
              <b>{file.name}</b>
              <span>
                {(file.size / 1024 / 1024).toFixed(1)} МБ · файл остаётся в
                браузере
              </span>
              <button
                type="button"
                className="plain-button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                Заменить изображение
              </button>
              <button type="button" className="plain-button" disabled={busy} onClick={() => void rotate()}>
                Повернуть 90°
              </button>
              <button type="button" className="plain-button" disabled={busy} onClick={() => setCropOpen((open) => !open)}>
                {cropOpen ? "Скрыть область" : "Выбрать область текста"}
              </button>
            </div>
          </div>
          {cropOpen && (
            <div className="ocr-crop-controls" aria-label="Область изображения для OCR">
              <p>Оставьте в области только текст. Изменение применяется к реальным пикселям перед OCR.</p>
              <label>Слева <input type="range" min="0" max="80" value={Math.round(crop.left * 100)} onChange={(event) => void updateCrop({ ...crop, left: Math.min(Number(event.target.value) / 100, crop.right - .02) })} /></label>
              <label>Сверху <input type="range" min="0" max="80" value={Math.round(crop.top * 100)} onChange={(event) => void updateCrop({ ...crop, top: Math.min(Number(event.target.value) / 100, crop.bottom - .02) })} /></label>
              <label>Справа <input type="range" min="20" max="100" value={Math.round(crop.right * 100)} onChange={(event) => void updateCrop({ ...crop, right: Math.max(Number(event.target.value) / 100, crop.left + .02) })} /></label>
              <label>Снизу <input type="range" min="20" max="100" value={Math.round(crop.bottom * 100)} onChange={(event) => void updateCrop({ ...crop, bottom: Math.max(Number(event.target.value) / 100, crop.top + .02) })} /></label>
            </div>
          )}
          {!recognized && (
            <div className="ocr-run">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void runOcr()}
              >
                {busy ? "Распознаём…" : "Распознать RU + KZ"}
              </button>
              {busy && (
                <div className="ocr-progress" role="status">
                  <span
                    style={{
                      width: `${Math.round((progress?.progress ?? 0) * 100)}%`,
                    }}
                  />
                  <p>
                    {ocrStatus[progress?.status ?? ""] ?? "Подготавливаем OCR"}{" "}
                    · {Math.round((progress?.progress ?? 0) * 100)}%
                  </p>
                </div>
              )}
            </div>
          )}
          {recognized && (
            <div className="ocr-review">
              <label htmlFor="ocr-recognized">
                Распознанный текст — проверьте суммы и удалите личные данные
              </label>
              <textarea
                id="ocr-recognized"
                value={recognized}
                onChange={(event) => setRecognized(event.target.value)}
                maxLength={100000}
              />
              {meta && (
                <>
                  <p className={`ocr-quality quality-${meta.quality}`}>
                    Уверенность Tesseract: {meta.confidence.toFixed(0)}% ·{" "}
                    {(meta.elapsedMs / 1000).toFixed(1)} с · {meta.preparedWidth}×{meta.preparedHeight}px.
                  </p>
                  {meta.quality === "good" ? <p>Текст выглядит читаемым, но суммы и сроки всё равно проверьте.</p> : <p className={meta.quality === "poor" ? "ocr-warning" : "ocr-normalization"}>{meta.quality === "poor" ? "Текст распознан с ошибками. Проверьте ориентацию изображения или попробуйте более чёткий скриншот." : "Результат требует внимательной проверки перед анализом."} {meta.qualityReasons.join("; ")}.</p>}
                  {meta.retriedOrientations && <p className="ocr-normalization">OCR проверил дополнительные ориентации и выбрал вариант {meta.rotation}°.</p>}
                  {meta.normalizations.map((item) => (
                    <p className="ocr-normalization" key={item}>
                      {item}. Проверьте исправление перед анализом.
                    </p>
                  ))}
                </>
              )}
              {meta?.quality === "poor" && (
                <label className="ocr-confirm"><input type="checkbox" checked={poorConfirmed} onChange={(event) => setPoorConfirmed(event.target.checked)} /> Я вручную проверил текст и числа.</label>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={!recognized.trim() || (meta?.quality === "poor" && !poorConfirmed)}
                onClick={() => void onAccept(recognized, file.name)}
              >
                {acceptLabel}
                <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        hidden
        aria-label="Загрузить скриншот для OCR"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <small className="ocr-note">
        PNG, JPEG или WebP · до 8 МБ · OCR выполняется локально в браузере
      </small>
    </div>
  );
}

function sessionMessages(): ConversationMessage[] {
  try {
    return JSON.parse(
      sessionStorage.getItem("pyramid-dna-conversation-messages") ?? "[]",
    ) as ConversationMessage[];
  } catch {
    return [];
  }
}
function mechanismAmount(
  amount: ConversationMechanism["fingerprint"]["deposit"],
) {
  if (!amount) return "Недостаточно данных";
  return `${amount.value.toLocaleString("ru-RU")} ${amount.currency === "KZT" ? "₸" : amount.currency}`;
}
function ConversationMechanismView({
  mechanism,
  evidence,
  activeFeature,
  activeMessage,
  onSelect,
}: {
  mechanism: ConversationMechanism;
  evidence: ConversationEvidence[];
  activeFeature?: string;
  activeMessage?: string;
  onSelect: (feature: string, mechanismId: string) => void;
}) {
  const fp = mechanism.fingerprint;
  const evidenceFor = (feature: string) =>
    evidence.some(
      (item) =>
        item.mechanism_id === mechanism.mechanism_id &&
        item.feature_type === feature,
    );
  const selectable = (feature: string, child: ReactNode) =>
    evidenceFor(feature) ? (
      <button
        type="button"
        className={
          activeFeature === feature &&
          evidence.some(
            (item) =>
              item.mechanism_id === mechanism.mechanism_id &&
              item.message_id === activeMessage &&
              item.feature_type === feature,
          )
            ? "trace-active"
            : ""
        }
        onClick={() => onSelect(feature, mechanism.mechanism_id)}
      >
        {child}
      </button>
    ) : (
      child
    );
  return (
    <article className="conversation-mechanism">
      <div className="conversation-mechanism-head">
        <div>
          <span>
            {mechanism.mechanism_id.replace("mechanism-", "Механизм ")}
          </span>
          <strong>
            {mechanism.connection_status === "confirmed"
              ? "Условия связаны"
              : mechanism.connection_status === "single_message"
                ? "Одно сообщение"
                : "Связь не подтверждена"}
          </strong>
        </div>
        <div className="mechanism-risk">
          <Risk risk={mechanism.risk_label} />
          <b>{mechanism.risk_points}</b>
          <small>баллов правил</small>
        </div>
      </div>
      <div className="money-flow conversation-flow">
        {fp.deposit &&
          selectable(
            "deposit",
            <>
              <small>Взнос</small>
              <strong>{mechanismAmount(fp.deposit)}</strong>
            </>,
          )}
        {fp.deposit && fp.payout && <span className="money-arrow">→</span>}
        {fp.payout &&
          selectable(
            "payout",
            <>
              <small>Обещанная выплата</small>
              <strong>{mechanismAmount(fp.payout)}</strong>
            </>,
          )}
        {!fp.deposit && !fp.payout && <p>Денежные суммы не подтверждены.</p>}
      </div>
      <div className="money-context">
        {fp.payout_multiplier != null && (
          <span>×{fp.payout_multiplier.toLocaleString("ru-RU")}</span>
        )}
        {fp.period_days != null &&
          selectable("period", <span>{fp.period_days} дн.</span>)}
        {fp.referral_count != null &&
          selectable(
            "recruitment",
            <span>{fp.referral_count} приглашённых</span>,
          )}
      </div>
      {mechanism.unknown_fields.length > 0 && (
        <p className="mechanism-unknown">
          Не установлено: {mechanism.unknown_fields.join(", ")}.
        </p>
      )}
      <div className="mechanism-factors">
        {mechanism.risk_factors.length ? (
          mechanism.risk_factors.map((factor, index) => (
            <div key={factor.indicator}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{factor.indicator}</p>
              <b>+{factor.points}</b>
            </div>
          ))
        ) : (
          <p className="muted">Сочетание правил риска не сработало.</p>
        )}
      </div>
    </article>
  );
}

function ConversationWorkspace({
  pending,
  runTask,
  exportData,
}: {
  pending: string;
  runTask: (name: string, fn: () => Promise<void>) => Promise<void>;
  exportData: (data: unknown, name: string) => void;
}) {
  const [raw, setRaw] = useState(
    () => sessionStorage.getItem("pyramid-dna-conversation-raw") ?? "",
  );
  const [messages, setMessages] =
    useState<ConversationMessage[]>(sessionMessages);
  const [preview, setPreview] = useState<ConversationPreview>();
  const [result, setResult] = useState<ConversationResult>();
  const [analyzedSignature, setAnalyzedSignature] = useState("");
  const [activeFeature, setActiveFeature] = useState<string>();
  const [activeMessage, setActiveMessage] = useState<string>();
  const [editingMessage, setEditingMessage] = useState<string>();
  const [showRaw, setShowRaw] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const signature = JSON.stringify(
    messages.map(
      ({ message_id, text, timestamp, author_label, is_system }) => ({
        message_id,
        text,
        timestamp,
        author_label,
        is_system,
      }),
    ),
  );
  const stale = !!result && signature !== analyzedSignature;
  useEffect(() => {
    sessionStorage.setItem("pyramid-dna-conversation-raw", raw);
  }, [raw]);
  useEffect(() => {
    sessionStorage.setItem(
      "pyramid-dna-conversation-messages",
      JSON.stringify(
        messages.map(
          ({
            message_id,
            order,
            text,
            timestamp,
            author_label,
            is_system,
            phone_redacted,
          }) => ({
            message_id,
            order,
            text,
            timestamp,
            author_label,
            is_system,
            phone_redacted,
          }),
        ),
      ),
    );
  }, [messages]);
  async function applyParsed(input: string, name: string) {
    const parsed = await api<ConversationPreview>("/conversation/parse", {
      text: input,
    });
    setRaw(input);
    setPreview(parsed);
    setMessages(parsed.messages);
    setResult(undefined);
    setAnalyzedSignature("");
    setDocumentName(name);
  }
  async function parse(input = raw, name = documentName) {
    if (input !== raw || name !== documentName) {
      await applyParsed(input, name);
      return;
    }
    await runTask("conversation-parse", () => applyParsed(input, name));
  }
  async function analyzeMessages() {
    await runTask("conversation-analyze", async () => {
      const response = await api<ConversationResult>("/analyze/conversation", {
        messages: messages.map(
          ({ message_id, text, timestamp, author_label, is_system }) => ({
            message_id,
            text,
            timestamp,
            author_label,
            is_system,
          }),
        ),
      });
      setResult(response);
      setAnalyzedSignature(signature);
      setMessages((current) =>
        current.map(
          (message) =>
            response.messages.find(
              (item) => item.message_id === message.message_id,
            ) ?? message,
        ),
      );
      if (matchMedia("(max-width:800px)").matches)
        setTimeout(
          () =>
            document
              .getElementById("conversation-result")
              ?.scrollIntoView({ behavior: "smooth", block: "start" }),
          0,
        );
    });
  }
  function updateMessage(messageId: string, text: string) {
    setMessages((items) =>
      items.map((item) =>
        item.message_id === messageId
          ? { ...item, text, analysis: undefined }
          : item,
      ),
    );
  }
  function addMessage() {
    const next =
      messages.reduce((max, item) => Math.max(max, item.order), 0) + 1;
    setMessages((items) => [
      ...items,
      {
        message_id: `manual-${Date.now()}`,
        order: next,
        text: "",
        timestamp: null,
        author_label: null,
        is_system: false,
      },
    ]);
  }
  function removeMessage(messageId: string) {
    setMessages((items) =>
      items
        .filter((item) => item.message_id !== messageId)
        .map((item, index) => ({ ...item, order: index + 1 })),
    );
  }
  function selectEvidence(featureType: string, mechanismId: string) {
    if (!result || stale) return;
    const match = result.evidence.find(
      (item) =>
        item.mechanism_id === mechanismId && item.feature_type === featureType,
    );
    if (!match) return;
    setActiveFeature(featureType);
    setActiveMessage(match.message_id);
    setTimeout(
      () =>
        document
          .getElementById(`conversation-message-${match.message_id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }
  const ready =
    messages.length > 0 &&
    messages.length <= 200 &&
    messages.every(
      (message) =>
        message.text.trim().length > 0 && message.text.length <= 10000,
    );
  return (
    <div className="conversation-workspace">
      <section className="conversation-editor editor-panel">
        <div className="panel-heading">
          <div className="heading-with-icon">
            <Icon name="scan" />
            <h2>Переписка для проверки</h2>
          </div>
          {messages.length > 0 && (
            <span className="subtle-label">{messages.length} сообщений</span>
          )}
        </div>
        {!messages.length ? (
          <div className="conversation-import">
            <label className="editor-label" htmlFor="conversation-raw">
              Текст экспорта или переписки
            </label>
            <textarea
              id="conversation-raw"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              maxLength={100000}
              placeholder={
                "Вставьте обезличенную переписку…\n\n21.10.2026, 14:32 - Участник A: Для участия нужен взнос 40 000 ₸."
              }
            />
            <div className="editor-status">
              <span>{raw.length.toLocaleString("ru-RU")} / 100 000</span>
              <span>Черновик сохраняется только в этой вкладке</span>
            </div>
            <div className="conversation-import-actions">
              <button
                className="secondary-button"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="upload" size={16} />
                Загрузить TXT
              </button>
              <button
                className="primary-button"
                disabled={!raw.trim() || !!pending}
                onClick={() => void parse()}
              >
                {pending === "conversation-parse"
                  ? "Разбираем…"
                  : "Разделить на сообщения"}
                <Icon name="arrow" size={16} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,text/plain"
                hidden
                aria-label="Загрузить TXT переписки"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void runTask("conversation-upload", async () => {
                    if (file.size > 100000)
                      throw new Error("Размер TXT не должен превышать 100 КБ.");
                    const input = await readUtf8TextFile(file);
                    await parse(input, file.name);
                  });
                  event.target.value = "";
                }}
              />
            </div>
            <OcrImport
              onAccept={(input, name) => parse(input, name)}
              acceptLabel="Разделить распознанный текст"
            />
            <p className="privacy-note-inline">
              <Icon name="info" size={15} />
              Перед анализом удалите личные данные. Номера телефонов в
              распознанных сообщениях скрываются автоматически.
            </p>
          </div>
        ) : (
          <div className="conversation-preview">
            <div className="conversation-preview-tools">
              <div>
                {documentName && (
                  <span className="document-name">
                    <Icon name="check" size={14} />
                    {documentName}
                  </span>
                )}
                <p>
                  Сообщения показаны компактно. Откройте только то, которое
                  нужно исправить.
                </p>
              </div>
              <div className="conversation-preview-actions">
                <button
                  className="plain-button"
                  onClick={() => setShowRaw((value) => !value)}
                >
                  {showRaw ? "Скрыть исходный текст" : "Исходная переписка"}
                </button>
                <button
                  className="plain-button"
                  onClick={() => {
                    setMessages([]);
                    setResult(undefined);
                    setPreview(undefined);
                  }}
                >
                  <Icon name="upload" size={15} />
                  Другой материал
                </button>
              </div>
            </div>
            {showRaw && (
              <textarea
                className="conversation-raw-review"
                value={raw}
                readOnly
                aria-label="Полная исходная переписка"
              />
            )}
            {preview?.warnings.map((warning) => (
              <div className="parse-warning" key={warning}>
                <Icon name="info" size={15} />
                {warning}
              </div>
            ))}
            <div className="conversation-message-list">
              {messages.map((message) => {
                const analyzed = result?.messages.find(
                  (item) => item.message_id === message.message_id,
                );
                const spans =
                  !stale && analyzed?.analysis
                    ? (analyzed.analysis.evidence_spans ?? [])
                    : [];
                const editing = editingMessage === message.message_id;
                const exclusion: Record<string, string> = {
                  warning_context:
                    "Предупреждение: упоминание не включено в механизм",
                  benign_context: "Обычная операция: не включена в механизм",
                  unconfirmed_quote:
                    "Цитата: не считается подтверждённым условием",
                  question_context: "Вопрос: не считается подтверждением",
                  unverified_context:
                    "Непроверенное утверждение: не включено в механизм",
                  negated_context: "Отрицание: условие не подтверждено",
                  system_message: "Системное сообщение",
                };
                return (
                  <article
                    id={`conversation-message-${message.message_id}`}
                    key={message.message_id}
                    className={`conversation-message ${activeMessage === message.message_id ? "trace-active" : ""}`}
                  >
                    <header>
                      <div>
                        <span>{String(message.order).padStart(2, "0")}</span>
                        <b>{message.author_label ?? "Автор не указан"}</b>
                        {message.timestamp && (
                          <time>
                            {new Date(message.timestamp).toLocaleString(
                              "ru-RU",
                            )}
                          </time>
                        )}
                      </div>
                      <div className="message-actions">
                        <button
                          className="plain-button"
                          onClick={() =>
                            setEditingMessage(
                              editing ? undefined : message.message_id,
                            )
                          }
                        >
                          {editing ? "Готово" : "Изменить"}
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Удалить сообщение ${message.order}`}
                          onClick={() => removeMessage(message.message_id)}
                        >
                          <Icon name="close" size={15} />
                        </button>
                      </div>
                    </header>
                    {editing ? (
                      <EvidenceEditor
                        id={`conversation-${message.message_id}`}
                        className="compare-evidence-editor"
                        text={message.text}
                        onChange={(text) =>
                          updateMessage(message.message_id, text)
                        }
                        label={`Сообщение ${message.order}`}
                        spans={spans}
                        active={spans.length > 0}
                        activeFeature={
                          activeMessage === message.message_id
                            ? activeFeature
                            : undefined
                        }
                        onFeatureSelect={(feature) => {
                          setActiveFeature(feature);
                          setActiveMessage(message.message_id);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="conversation-message-reading"
                        onClick={() => setEditingMessage(message.message_id)}
                      >
                        {highlightedText(
                          message.text,
                          spans,
                          activeMessage === message.message_id
                            ? activeFeature
                            : undefined,
                        )}
                      </button>
                    )}
                    {analyzed?.excluded_reason && (
                      <small className="excluded-message">
                        {exclusion[analyzed.excluded_reason] ??
                          "Не включено в механизм"}
                      </small>
                    )}
                  </article>
                );
              })}
            </div>
            <button className="plain-button add-message" onClick={addMessage}>
              <Icon name="plus" size={15} />
              Добавить сообщение вручную
            </button>
          </div>
        )}
        {messages.length > 0 && (
          <div className="conversation-submit">
            <button
              className="primary-button"
              disabled={!ready || !!pending}
              onClick={() => void analyzeMessages()}
            >
              <Icon name="scan" />
              {pending === "conversation-analyze"
                ? "Анализируем переписку…"
                : "Проверить переписку"}
              <Icon name="arrow" />
            </button>
            <span>
              Условия связываются осторожно; неподтверждённые связи остаются
              отдельными.
            </span>
          </div>
        )}
      </section>
      <section
        id="conversation-result"
        className={`conversation-result result-panel ${result ? "has-result" : ""}`}
        aria-live="polite"
      >
        <div className="panel-heading">
          <div className="heading-with-icon">
            <h2>Financial DNA переписки</h2>
          </div>
        </div>
        {!result ? (
          <div className="result-placeholder">
            <h3>Какие механизмы описаны в переписке?</h3>
            <p>
              После проверки здесь появятся связанные финансовые условия и
              точные сообщения, на которых основан вывод.
            </p>
          </div>
        ) : (
          <div className="conversation-result-body">
            {stale && (
              <div className="stale-notice">
                <Icon name="info" size={16} />
                Сообщения изменены. Повторите анализ.
              </div>
            )}
            <div className="conversation-overall">
              <div>
                <Risk risk={result.risk_label} />
                <h3>
                  {result.mechanisms.length
                    ? `${result.mechanisms.length} ${result.mechanisms.length === 1 ? "механизм" : "механизма"} для проверки`
                    : "Финансовый механизм не подтверждён"}
                </h3>
                <p>{result.risk_method}</p>
              </div>
              <strong>
                {result.risk_points}
                <small>/100</small>
              </strong>
            </div>
            {result.conflicts.map((conflict) => (
              <div
                className="parse-warning"
                key={conflict.type + conflict.message_ids.join()}
              >
                <Icon name="info" size={15} />
                {conflict.explanation}
              </div>
            ))}
            {result.unknowns.map((unknown) => (
              <div
                className="connection-warning"
                key={unknown.mechanism_id + unknown.field}
              >
                {unknown.explanation}
              </div>
            ))}
            {result.mechanisms.map((mechanism) => (
              <ConversationMechanismView
                key={mechanism.mechanism_id}
                mechanism={mechanism}
                evidence={result.evidence}
                activeFeature={activeFeature}
                activeMessage={activeMessage}
                onSelect={selectEvidence}
              />
            ))}
            <p className="conversation-disclaimer">{result.disclaimer}</p>
            <div className="result-bottom-actions">
              <button
                onClick={() =>
                  exportData(
                    { ...result, created_at: new Date().toISOString() },
                    "pyramid-dna-conversation.json",
                  )
                }
              >
                <Icon name="download" size={16} />
                Отчёт JSON
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
function App() {
  const navigate = useNavigate(),
    location = useLocation();
  const route = location.pathname;
  const [text, setText] = useState(""),
    [right, setRight] = useState("");
  const [leftDocument, setLeftDocument] = useState(""),
    [rightDocument, setRightDocument] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>(),
    [analyzedText, setAnalyzedText] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"message" | "conversation">(
    () =>
      sessionStorage.getItem("pyramid-dna-analysis-mode") === "conversation"
        ? "conversation"
        : "message",
  );
  const [activeFeature, setActiveFeature] = useState<string>();
  const [comparison, setComparison] = useState<Comparison>(),
    [comparedTexts, setComparedTexts] = useState<string[]>([]);
  const [neighbors, setNeighbors] = useState<Neighbor[]>(),
    [neighborAnchor, setNeighborAnchor] = useState(""),
    [threshold, setThreshold] = useState(0.7);
  const [report, setReport] = useState<{ data: unknown; name: string }>();
  const [pending, setPending] = useState(""),
    [error, setError] = useState<Error>(),
    [notice, setNotice] = useState("");
  const [palette, setPalette] = useState(false),
    [command, setCommand] = useState(""),
    [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [record, setRecord] = useState<RecordItem | CaseItem>(),
    [recordAnalysis, setRecordAnalysis] = useState<Analysis>();
  const [caseOpen, setCaseOpen] = useState(false),
    [editingCase, setEditingCase] = useState<CaseItem>(),
    [caseText, setCaseText] = useState("");
  const [libraryTab, setLibraryTab] = useState("dataset");
  const fileRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<(() => void) | undefined>(undefined);
  const taskRef = useRef(false);
  const cases = useQuery({
    queryKey: ["cases"],
    queryFn: () => api<{ items: CaseItem[] }>("/cases"),
    enabled: route === "/materials" || caseOpen,
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.key === "Escape") setWorkspaceMenu(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (text || right || caseOpen) e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [text, right, caseOpen]);
  useEffect(() => {
    setWorkspaceMenu(false);
    setError(undefined);
  }, [route]);
  useEffect(() => {
    setActiveFeature(undefined);
  }, [text, right]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    sessionStorage.setItem("pyramid-dna-analysis-mode", analysisMode);
  }, [analysisMode]);
  async function task(name: string, fn: () => Promise<void>) {
    if (taskRef.current) return;
    taskRef.current = true;
    setPending(name);
    setError(undefined);
    retryRef.current = () => void task(name, fn);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e : new Error("Не удалось выполнить действие."),
      );
    } finally {
      taskRef.current = false;
      setPending("");
    }
  }
  async function analyze(input = text) {
    await task("analyze", async () => {
      const r = await api<{ analysis: Analysis }>("/analyze", { text: input });
      setAnalysis(r.analysis);
      setAnalyzedText(input);
      setNeighbors(undefined);
      if (matchMedia("(max-width:800px)").matches)
        setTimeout(
          () =>
            document
              .getElementById("analysis-result")
              ?.scrollIntoView({ behavior: "smooth", block: "start" }),
          0,
        );
    });
  }
  async function findSimilar() {
    await task("search", async () => {
      const r = await api<{ neighbors: Neighbor[] }>("/search/similar", {
        text: analyzedText,
        top_k: 10,
        min_similarity: threshold,
      });
      setNeighbors(r.neighbors);
      setNeighborAnchor(analyzedText);
      setTimeout(
        () =>
          document
            .getElementById("similar-results")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        0,
      );
    });
  }
  async function openRecord(item: RecordItem | CaseItem) {
    await task("record", async () => {
      if ("analysis" in item) {
        setRecordAnalysis(item.analysis);
        setRecord(item);
      } else {
        const r = await api<{ record: RecordItem; analysis: Analysis }>(
          "/records/" + item.id,
        );
        setRecordAnalysis(r.analysis);
        setRecord(r.record);
      }
    });
  }
  function startCase(item?: CaseItem) {
    setEditingCase(item);
    setCaseText(item?.text ?? analyzedText);
    setCaseOpen(true);
  }
  function toCompare(input: string, anchor?: string) {
    if (anchor) setText(anchor);
    setRight(input);
    setRecord(undefined);
    navigate("/compare");
    window.scrollTo(0, 0);
  }
  function exportData(data: unknown, name: string) {
    setReport({ data, name });
  }
  function selectEvidence(
    featureType: string,
    sourceId = "source-text",
    spans = confirmedSpans(analysis),
  ) {
    if (
      (sourceId === "source-text" && analyzedText !== text) ||
      (sourceId === "compare-text-A" && comparedTexts[0] !== text) ||
      (sourceId === "compare-text-B" && comparedTexts[1] !== right)
    )
      return;
    setActiveFeature(featureType);
    const span = spans.find((s) => s.feature_type === featureType);
    const editor = document.getElementById(
      sourceId,
    ) as HTMLTextAreaElement | null;
    if (span && editor) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(span.start, span.end);
      editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  const validText = text.trim().length >= 3 && text.length <= 10000;
  const current = sections.find((s) => s.path === route) ?? sections[0];
  const commands = [
    ...navigationSections.map((s) => ({
      name: s.label,
      description: s.description,
      action: () => navigate(s.path),
    })),
    {
      name: "База примеров",
      description: "Открыть синтетические материалы",
      action: () => {
        setLibraryTab("dataset");
        navigate("/materials");
      },
    },
    {
      name: "Рабочие дела",
      description: "Открыть сохранённые материалы",
      action: () => {
        setLibraryTab("cases");
        navigate("/materials");
      },
    },
  ].filter((c) =>
    `${c.name} ${c.description}`.toLowerCase().includes(command.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#/" aria-label="PYRAMID DNA — проверка">
          <span className="brand-symbol">
            <svg
              width="29"
              height="29"
              viewBox="0 0 30 30"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="m15 3 12 23H3L15 3Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="m9 15 12 11M12 9l12 17M6 21h18"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </span>
          <span>
            PYRAMID <b>DNA</b>
            <small>Финансовые механизмы под проверкой</small>
          </span>
        </a>
        <nav className="desktop-nav" aria-label="Основная навигация">
          {navigationSections.map((s) => (
            <button
              key={s.path}
              className={route === s.path ? "nav-item active" : "nav-item"}
              onClick={() => navigate(s.path)}
            >
              <Icon name={s.icon} size={17} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="search-command"
            aria-label="Поиск"
            onClick={() => setPalette(true)}
          >
            <Icon name="search" size={17} />
            <span>Поиск</span>
          </button>
          <button
            className="mobile-menu"
            onClick={() => setWorkspaceMenu((v) => !v)}
            aria-expanded={workspaceMenu}
          >
            {current.label} <span>⌄</span>
          </button>
        </div>
      </header>
      {workspaceMenu && (
        <>
          <button
            className="menu-backdrop"
            aria-label="Закрыть навигацию"
            onClick={() => setWorkspaceMenu(false)}
          />
          <nav className="mobile-navigation">
            {navigationSections.map((s) => (
              <button
                key={s.path}
                onClick={() => {
                  navigate(s.path);
                  setWorkspaceMenu(false);
                }}
              >
                <Icon name={s.icon} />
                <span>
                  <b>{s.label}</b>
                  <small>{s.description}</small>
                </span>
              </button>
            ))}
          </nav>
        </>
      )}
      <main className="main-content">
        {error && <ErrorNotice error={error} retry={retryRef.current} />}
        {notice && (
          <div className="toast" role="status">
            <Icon name="check" />
            {notice}
            <button
              aria-label="Скрыть уведомление"
              onClick={() => setNotice("")}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {route === "/" && (
          <>
            <div className="page-intro check-intro">
              <div>
                <h1>
                  {analysisMode === "message"
                    ? "Проверка финансового предложения"
                    : "Анализ финансовой переписки"}
                </h1>
                <p>
                  {analysisMode === "message"
                    ? "Проверьте текст предложения: деньги, условия выплат и признаки привлечения участников."
                    : "Найдите условия, распределённые между сообщениями, и проверьте, как они связаны."}
                </p>
              </div>
              <div
                className="analysis-mode"
                role="group"
                aria-label="Режим проверки"
              >
                <button
                  className={analysisMode === "message" ? "active" : ""}
                  onClick={() => setAnalysisMode("message")}
                >
                  Сообщение
                </button>
                <button
                  className={analysisMode === "conversation" ? "active" : ""}
                  onClick={() => setAnalysisMode("conversation")}
                >
                  Переписка
                </button>
              </div>
            </div>
            {analysisMode === "message" ? (
              <>
                <div className="message-ocr-import">
                  <OcrImport
                    acceptLabel="Использовать распознанный текст"
                    onAccept={(input) => {
                      setText(input.slice(0, 10000));
                      setAnalysis(undefined);
                      setAnalyzedText("");
                      setNeighbors(undefined);
                    }}
                  />
                </div>
                <div className="workspace-grid">
                  <section
                    className={`editor-panel ${analysis ? "with-analysis" : ""}`}
                  >
                    <div className="panel-heading">
                      <div className="heading-with-icon">
                        <Icon name="scan" />
                        <h2>Материал для проверки</h2>
                      </div>
                    </div>
                    <div className="editor-content">
                      <label className="editor-label" htmlFor="source-text">
                        Текст финансового предложения
                      </label>
                      <EvidenceEditor
                        id="source-text"
                        className="analysis-editor"
                        text={text}
                        onChange={setText}
                        label="Текст финансового предложения"
                        placeholder="Вставьте сообщение, публикацию или условия участия…"
                        spans={confirmedSpans(analysis)}
                        active={!!analysis && analyzedText === text}
                        activeFeature={activeFeature}
                        onFeatureSelect={setActiveFeature}
                        onKeyDown={(e) => {
                          if (
                            (e.ctrlKey || e.metaKey) &&
                            e.key === "Enter" &&
                            validText &&
                            !pending
                          ) {
                            e.preventDefault();
                            void analyze();
                          }
                        }}
                      />
                      <div className="editor-status">
                        <span className={text.length > 10000 ? "danger" : ""}>
                          {text.length.toLocaleString("ru-RU")} / 10 000
                        </span>
                        <span>Черновик только в этой вкладке</span>
                      </div>
                      {text.length > 10000 && (
                        <p className="field-error">
                          Сократите текст до 10 000 символов.
                        </p>
                      )}
                      <div className="editor-secondary">
                        <button
                          className="plain-button"
                          onClick={() => fileRef.current?.click()}
                        >
                          <Icon name="upload" size={16} />
                          Загрузить .txt
                        </button>
                        <button
                          className="plain-button"
                          disabled={!text}
                          onClick={() => {
                            setText("");
                            setAnalysis(undefined);
                            setNeighbors(undefined);
                            document.getElementById("source-text")?.focus();
                          }}
                        >
                          Очистить
                        </button>
                        <input
                          ref={fileRef}
                          type="file"
                          accept=".txt,text/plain"
                          hidden
                          aria-label="Загрузить текстовый файл"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            void task("upload", async () => {
                              if (file.size > 100000)
                                throw new Error(
                                  "Размер файла не должен превышать 100 КБ.",
                                );
                              const input = await readUtf8TextFile(file);
                              setText(input);
                              setAnalysis(undefined);
                              setAnalyzedText("");
                              document.getElementById("source-text")?.focus();
                            });
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                    <div className="editor-submit">
                      <button
                        className="primary-button"
                        disabled={!validText || !!pending}
                        onClick={() => void analyze()}
                      >
                        <Icon name="scan" />
                        {pending === "analyze"
                          ? "Проверяем материал…"
                          : "Проверить материал"}
                        <Icon name="arrow" />
                      </button>
                      <span>Ctrl + Enter</span>
                    </div>
                    <div className="privacy-note">
                      <Icon name="info" size={16} />
                      <p>
                        Текст не сохраняется без вашей команды. Используйте
                        публичные или обезличенные материалы.
                      </p>
                    </div>
                  </section>
                  <section
                    id="analysis-result"
                    className={`result-panel ${analysis ? "has-result" : ""}`}
                    aria-live="polite"
                  >
                    <div className="panel-heading">
                      <div className="heading-with-icon">
                        <h2>Результат проверки</h2>
                      </div>
                    </div>
                    {!analysis ? (
                      <div className="result-placeholder">
                        <h3>Что содержится в предложении?</h3>
                        <p>
                          Вставьте текст. Здесь появятся
                          суммы, условия выплаты и основания оценки.
                        </p>
                      </div>
                    ) : (
                      <div className="result-body">
                        {analyzedText !== text && (
                          <div className="stale-notice">
                            <Icon name="info" size={16} />
                            Текст изменён. Повторите проверку для новой версии.
                          </div>
                        )}
                        <FinancialHero
                          analysis={analysis}
                          activeFeature={activeFeature}
                          onFeatureSelect={(type) => selectEvidence(type)}
                        />
                        <TraceLinks
                          analysis={analysis}
                          activeFeature={activeFeature}
                          onFeatureSelect={(type) => selectEvidence(type)}
                        />
                        <AnalysisSummary analysis={analysis} />
                        <div className="result-section">
                          <h3>
                            Причины оценки{" "}
                            <span>
                              {factorCountLabel(
                                (
                                  analysis.risk_breakdown?.factors ??
                                  analysis.evidence
                                ).length,
                              )}
                            </span>
                          </h3>
                          <Evidence
                            analysis={analysis}
                            activeFeature={activeFeature}
                          />
                        </div>
                        <div className="result-section result-details">
                          <h3>Все извлечённые условия</h3>
                          <FinancialModel
                            analysis={analysis}
                            activeFeature={activeFeature}
                            onFeatureSelect={(type) => selectEvidence(type)}
                          />
                        </div>
                        <div className="result-geography">
                          <Icon name="info" size={15} />
                          {analysis.kz_relevance_indicator === "possible"
                            ? "В тексте есть маркер связи с Казахстаном."
                            : "Связь с Казахстаном по тексту не установлена."}
                        </div>
                        <div className="result-actions">
                          <button
                            className="secondary-button"
                            disabled={!!pending}
                            onClick={() => void findSimilar()}
                          >
                            <Icon name="search" />
                            {pending === "search"
                              ? "Ищем похожие…"
                              : "Найти похожие механизмы"}
                            <Icon name="arrow" size={16} />
                          </button>
                          <label className="threshold-control">
                            От
                            <select
                              aria-label="Минимальное сходство"
                              value={threshold}
                              onChange={(e) =>
                                setThreshold(Number(e.target.value))
                              }
                            >
                              <option value={0.7}>70%</option>
                              <option value={0.8}>80%</option>
                              <option value={0.9}>90%</option>
                            </select>
                          </label>
                        </div>
                        <div className="result-bottom-actions">
                          <button
                            onClick={() => {
                              setText(analyzedText);
                              navigate("/compare");
                            }}
                          >
                            <Icon name="compare" size={16} />
                            Сравнить
                          </button>
                          <button onClick={() => startCase()}>
                            <Icon name="save" size={16} />
                            Сохранить в дело
                          </button>
                          <button
                            onClick={() =>
                              exportData(
                                {
                                  text: analyzedText,
                                  analysis,
                                  disclaimer,
                                  created_at: new Date().toISOString(),
                                },
                                "pyramid-dna-analysis.json",
                              )
                            }
                          >
                            <Icon name="download" size={16} />
                            Отчёт JSON
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
                {neighbors && (
                  <section
                    id="similar-results"
                    className="content-panel similar-panel"
                  >
                    <div className="section-heading">
                      <div>
                        <p className="overline">
                          ПОИСК ПО ФИНАНСОВОЙ СТРУКТУРЕ
                        </p>
                        <h2>
                          Похожие механизмы{" "}
                          <span className="count-badge">
                            {neighbors.length}
                          </span>
                        </h2>
                      </div>
                      <button
                        className="plain-button"
                        onClick={() => setNeighbors(undefined)}
                      >
                        Скрыть
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                    <p className="muted">
                      Все найденные примеры синтетические. Сходство условий не
                      доказывает общего организатора.
                    </p>
                    {neighbors.length ? (
                      <div className="neighbor-list">
                        {neighbors.map((n) => (
                          <div key={n.id} className="neighbor-row">
                            <div className="similarity-score">
                              {(n.similarity * 100).toFixed(1)}
                              <span>% сходства</span>
                            </div>
                            <div className="neighbor-main">
                              <button
                                className="record-link"
                                onClick={() => void openRecord(n)}
                              >
                                {n.id} <span>{n.language?.toUpperCase()}</span>
                                <Icon name="chevron" size={14} />
                              </button>
                              <p>{n.text}</p>
                              <small>
                                {n.shared_features.map(feature).join(" · ")}
                              </small>
                            </div>
                            <button
                              className="secondary-button"
                              onClick={() => toCompare(n.text, neighborAnchor)}
                            >
                              <Icon name="compare" size={16} />
                              Сравнить
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="По этому порогу совпадений нет"
                        icon="search"
                      >
                        <p>Уменьшите минимальное сходство и повторите поиск.</p>
                      </Empty>
                    )}
                  </section>
                )}
              </>
            ) : (
              <ConversationWorkspace
                pending={pending}
                runTask={task}
                exportData={exportData}
              />
            )}
          </>
        )}
        {route === "/compare" && (
          <>
            <PageTitle
              eyebrow="СРАВНЕНИЕ МЕХАНИЗМОВ"
              title="Сравнение финансовых механизмов"
              description="Сопоставьте финансовую структуру двух предложений, даже на разных языках."
            />
            <div className="compare-grid">
              <TextPanel
                letter="A"
                title="Материал A"
                text={text}
                onChange={setText}
                documentName={leftDocument}
                onDocumentName={setLeftDocument}
                analysis={
                  comparison && comparedTexts[0] === text
                    ? comparison.left_analysis
                    : undefined
                }
                activeFeature={activeFeature}
                onFeatureSelect={setActiveFeature}
              />
              <TextPanel
                letter="B"
                title="Материал B"
                text={right}
                onChange={setRight}
                documentName={rightDocument}
                onDocumentName={setRightDocument}
                analysis={
                  comparison && comparedTexts[1] === right
                    ? comparison.right_analysis
                    : undefined
                }
                activeFeature={activeFeature}
                onFeatureSelect={setActiveFeature}
              />
            </div>
            <div className="compare-controls">
              <button
                className="primary-button"
                disabled={
                  !validText ||
                  right.trim().length < 3 ||
                  right.length > 10000 ||
                  !!pending
                }
                onClick={() =>
                  void task("compare", async () => {
                    const r = await api<Comparison>("/compare", {
                      left: { text },
                      right: { text: right },
                    });
                    setComparison(r);
                    setComparedTexts([text, right]);
                  })
                }
              >
                <Icon name="compare" />
                {pending === "compare" ? "Сопоставляем…" : "Сравнить механизмы"}
                <Icon name="arrow" />
              </button>
              <span>Сравниваем условия, а не совпадение слов.</span>
            </div>
            {comparison && (
              <section className="content-panel comparison-results">
                <div className="comparison-mechanisms">
                  <FinancialHero
                    analysis={comparison.left_analysis}
                    title="Материал A"
                    activeFeature={activeFeature}
                    onFeatureSelect={(type) =>
                      selectEvidence(
                        type,
                        "compare-text-A",
                        confirmedSpans(comparison.left_analysis),
                      )
                    }
                  />
                  <FinancialHero
                    analysis={comparison.right_analysis}
                    title="Материал B"
                    activeFeature={activeFeature}
                    onFeatureSelect={(type) =>
                      selectEvidence(
                        type,
                        "compare-text-B",
                        confirmedSpans(comparison.right_analysis),
                      )
                    }
                  />
                </div>
                <div className="comparison-overview">
                  <div className="comparison-score">
                    {(comparison.comparison.similarity * 100).toFixed(1)}
                    <span>%</span>
                  </div>
                  <div>
                    <p className="overline">СТРУКТУРНОЕ СХОДСТВО</p>
                    <h2>
                      {comparison.comparison.is_similar
                        ? "Механизмы похожи по условиям"
                        : "Порог сходства не достигнут"}
                    </h2>
                    <p>
                      Порог движка — 80%. Это не устанавливает общего
                      организатора.
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      exportData(
                        { ...comparison, texts: comparedTexts, disclaimer },
                        "pyramid-dna-comparison.json",
                      )
                    }
                  >
                    <Icon name="download" size={16} />
                    Отчёт JSON
                  </button>
                </div>
                {(text !== comparedTexts[0] || right !== comparedTexts[1]) && (
                  <div className="stale-notice">
                    Тексты изменены. Результат относится к предыдущим версиям.
                  </div>
                )}
                <div className="table-scroll">
                  <table className="comparison-table feature-comparison-table">
                    <thead>
                      <tr>
                        <th>Условие</th>
                        <th>Материал A</th>
                        <th>Материал B</th>
                        <th>Совпадение</th>
                        <th>Вклад</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.comparison.feature_comparison.map((row) => (
                        <tr key={row.feature}>
                          <th>
                            {fieldEvidence[row.feature] &&
                            (confirmedFeature(
                              comparison.left_analysis,
                              fieldEvidence[row.feature],
                            ) ||
                              confirmedFeature(
                                comparison.right_analysis,
                                fieldEvidence[row.feature],
                              )) ? (
                              <button
                                type="button"
                                className={`compare-feature-button ${fieldEvidence[row.feature] === activeFeature ? "trace-active" : ""}`}
                                onClick={() => {
                                  const type = fieldEvidence[row.feature];
                                  const leftHasEvidence = confirmedSpans(
                                    comparison.left_analysis,
                                  ).some((s) => s.feature_type === type);
                                  selectEvidence(
                                    type,
                                    leftHasEvidence
                                      ? "compare-text-A"
                                      : "compare-text-B",
                                    leftHasEvidence
                                      ? confirmedSpans(comparison.left_analysis)
                                      : confirmedSpans(
                                          comparison.right_analysis,
                                        ),
                                  );
                                }}
                              >
                                {labels[row.feature] ?? row.label}
                              </button>
                            ) : (
                              (labels[row.feature] ?? row.label)
                            )}
                          </th>
                          <td>{value(row.left_value, row.feature)}</td>
                          <td>{value(row.right_value, row.feature)}</td>
                          <td
                            title={row.explanation}
                            className={`feature-status ${row.status}`}
                          >
                            {row.status === "exact_match"
                              ? "Совпадает"
                              : row.status === "partial_match"
                                ? "Частично"
                                : row.status === "conflict"
                                  ? "Различается"
                                  : row.status === "missing_left"
                                    ? "Нет данных в A"
                                    : row.status === "missing_right"
                                      ? "Нет данных в B"
                                      : "Недостаточно данных"}
                          </td>
                          <td>
                            {(row.normalized_contribution * 100).toLocaleString(
                              "ru-RU",
                              { maximumFractionDigits: 1 },
                            )}
                            %
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={4}>Сумма вкладов в сходство</th>
                        <td>
                          {(
                            comparison.comparison.feature_comparison.reduce(
                              (sum, row) => sum + row.normalized_contribution,
                              0,
                            ) * 100
                          ).toLocaleString("ru-RU", {
                            maximumFractionDigits: 1,
                          })}
                          %
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="comparison-caution">
                  {comparison.comparison.caution}
                </p>
              </section>
            )}
          </>
        )}
        {route === "/materials" && (
          <Library
            tab={libraryTab}
            setTab={setLibraryTab}
            cases={cases.data?.items}
            casesError={cases.error ?? undefined}
            casesPending={cases.isPending}
            retryCases={() => void cases.refetch()}
            open={(item) => void openRecord(item)}
            createCase={() => startCase()}
          />
        )}
        {route === "/quality" && <Quality />}
        {route === "/method" && <Method />}
      </main>
      <footer className="app-footer">
        <span>
          PYRAMID DNA <b>·</b> SafeNet KZ
        </span>
      </footer>
      <Modal open={palette} close={() => setPalette(false)} title="Поиск">
        <div className="command-search">
          <Icon name="search" />
          <input
            data-autofocus
            aria-label="Поиск по разделам и действиям"
            placeholder="Введите запрос…"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-list">
          {commands.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                c.action();
                setPalette(false);
                setCommand("");
              }}
            >
              <span>
                <b>{c.name}</b>
                <small>{c.description}</small>
              </span>
              <Icon name="arrow" size={16} />
            </button>
          ))}
          {!commands.length && <p className="muted">Команды не найдены.</p>}
        </div>
      </Modal>
      <Modal
        open={!!record}
        close={() => setRecord(undefined)}
        title={
          record && "title" in record
            ? record.title
            : (record?.id ?? "Материал")
        }
        drawer
      >
        {record && (
          <div className="drawer-content">
            <span className="source-badge">
              {"analysis" in record
                ? "Рабочее дело"
                : "Синтетический пример · " + record.language}
            </span>
            <p className="record-source-text">{record.text}</p>
            {"analysis" in record && (
              <>
                <dl className="case-metadata">
                  <div>
                    <dt>Происхождение</dt>
                    <dd>{origins[record.source_type]}</dd>
                  </div>
                  <div>
                    <dt>Источник</dt>
                    <dd>{record.source_url || "Ручная загрузка"}</dd>
                  </div>
                  <div>
                    <dt>Статус</dt>
                    <dd>{statuses[record.status]}</dd>
                  </div>
                  <div>
                    <dt>Добавлено</dt>
                    <dd>
                      {new Date(record.created_at).toLocaleString("ru-RU")}
                    </dd>
                  </div>
                  <div>
                    <dt>Заметки</dt>
                    <dd>{record.notes || "Не добавлены"}</dd>
                  </div>
                  <div>
                    <dt>SHA-256</dt>
                    <dd className="hash">{record.sha256}</dd>
                  </div>
                </dl>
                <div className="drawer-buttons">
                  <button
                    className="secondary-button"
                    onClick={() => startCase(record)}
                  >
                    Редактировать дело
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      exportData(
                        { ...record, disclaimer },
                        `case-${record.id}.json`,
                      )
                    }
                  >
                    <Icon name="download" size={16} />
                    JSON
                  </button>
                  <button
                    className="danger-button"
                    disabled={!!pending}
                    onClick={() => {
                      if (
                        confirm(
                          "Удалить дело? Восстановить его будет невозможно.",
                        )
                      )
                        void task("delete", async () => {
                          await api("/cases/" + record.id, undefined, "DELETE");
                          setRecord(undefined);
                          await cases.refetch();
                          setNotice("Дело удалено.");
                        });
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </>
            )}
            <div className="drawer-buttons">
              <button
                className="secondary-button"
                onClick={() => {
                  setText(record.text);
                  setAnalysis(recordAnalysis);
                  setAnalyzedText(record.text);
                  setNeighbors(undefined);
                  setRecord(undefined);
                  navigate("/");
                }}
              >
                <Icon name="scan" size={16} />
                Открыть в проверке
              </button>
              <button
                className="secondary-button"
                onClick={() => toCompare(record.text)}
              >
                <Icon name="compare" size={16} />В материал B
              </button>
            </div>
            {recordAnalysis && (
              <>
                <AnalysisSummary analysis={recordAnalysis} />
                <h3>Финансовые условия</h3>
                <FinancialModel analysis={recordAnalysis} />
                <h3>Основания оценки</h3>
                <Evidence analysis={recordAnalysis} />
              </>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={!!report}
        close={() => setReport(undefined)}
        title="Аналитический отчёт JSON"
      >
        {report && (
          <div className="report-preview">
            <p className="muted">
              Исходные данные и выводы движка. Можно сохранить файл или
              скопировать текст.
            </p>
            <textarea
              aria-label="Содержимое JSON-отчёта"
              readOnly
              value={JSON.stringify(report.data, null, 2)}
            />
            <div className="form-footer">
              <button
                className="secondary-button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(JSON.stringify(report.data, null, 2))
                    .then(() => setNotice("Отчёт скопирован."))
                    .catch(() =>
                      setNotice("Выделите текст отчёта и скопируйте Ctrl+C."),
                    );
                }}
              >
                Копировать
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  download(report.data, report.name);
                  setNotice("Файл передан браузеру для сохранения.");
                }}
              >
                <Icon name="download" size={17} />
                Скачать JSON
              </button>
            </div>
          </div>
        )}
      </Modal>
      <CaseForm
        open={caseOpen}
        item={editingCase}
        initialText={caseText}
        pending={pending === "save"}
        error={caseOpen ? error : undefined}
        close={() => setCaseOpen(false)}
        save={(payload) =>
          void task("save", async () => {
            await api(
              "/cases" + (editingCase ? "/" + editingCase.id : ""),
              payload,
              editingCase ? "PUT" : "POST",
            );
            setCaseOpen(false);
            setRecord(undefined);
            await cases.refetch();
            setNotice(
              "Дело сохранено. Оно доступно в разделе «Материалы → Рабочие дела».",
            );
          })
        }
      />
    </div>
  );
}

function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-intro">
      <div>
        <p className="overline">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function TextPanel({
  letter,
  title,
  text,
  onChange,
  documentName,
  onDocumentName,
  analysis,
  activeFeature,
  onFeatureSelect,
}: {
  letter: string;
  title: string;
  text: string;
  onChange: (v: string) => void;
  documentName: string;
  onDocumentName: (v: string) => void;
  analysis?: Analysis;
  activeFeature?: string;
  onFeatureSelect?: (feature: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState(""),
    [reading, setReading] = useState(false);
  async function importFile(file?: File) {
    if (!file) return;
    setFileError("");
    setReading(true);
    try {
      const content = await readUtf8TextFile(file);
      onChange(content);
      onDocumentName(file.name);
    } catch (e) {
      setFileError(
        e instanceof Error ? e.message : "Не удалось прочитать TXT-файл.",
      );
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  return (
    <section className="text-panel">
      <div className="panel-heading">
        <div className="heading-with-icon">
          <span className="letter-badge">{letter}</span>
          <h2>{title}</h2>
        </div>
      </div>
      <EvidenceEditor
        id={`compare-text-${letter}`}
        className="compare-evidence-editor"
        label={"Материал " + letter}
        text={text}
        onChange={onChange}
        placeholder="Вставьте исходный текст предложения…"
        spans={confirmedSpans(analysis)}
        active={!!analysis}
        activeFeature={activeFeature}
        onFeatureSelect={onFeatureSelect}
      />
      <div className="text-panel-footer">
        <span className={text.length > 10000 ? "danger" : ""}>
          {text.length.toLocaleString("ru-RU")} / 10 000 символов
        </span>
        <button
          className="import-text-button"
          disabled={reading}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="upload" size={15} />
          {reading ? "Читаем…" : "Загрузить TXT"}
        </button>
        <button
          disabled={!text && !documentName}
          onClick={() => {
            onChange("");
            onDocumentName("");
            setFileError("");
          }}
        >
          Очистить
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          hidden
          aria-label={`Загрузить TXT для материала ${letter}`}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
      </div>
      {documentName && (
        <p className="document-name" title={documentName}>
          <Icon name="check" size={14} />
          {documentName}
          {text && analysis ? " · текст загружен" : ""}
        </p>
      )}
      {fileError && (
        <p className="field-error" role="alert">
          {fileError}
        </p>
      )}
      <small className="text-import-note">UTF-8 · UTF-8 BOM · до 100 КБ</small>
    </section>
  );
}
function Library({
  tab,
  setTab,
  cases,
  casesError,
  casesPending,
  retryCases,
  open,
  createCase,
}: {
  tab: string;
  setTab: (v: string) => void;
  cases?: CaseItem[];
  casesError?: Error;
  casesPending: boolean;
  retryCases: () => void;
  open: (item: RecordItem | CaseItem) => void;
  createCase: () => void;
}) {
  const [q, setQ] = useState(""),
    [risk, setRisk] = useState(""),
    [language, setLanguage] = useState(""),
    [split, setSplit] = useState(""),
    [page, setPage] = useState(1);
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: () =>
      api<{ total: number; languages: Record<string, number> }>(
        "/dataset/stats",
      ),
  });
  const records = useQuery({
    queryKey: ["records", q, risk, language, split, page],
    queryFn: () =>
      api<{ total: number; items: RecordItem[] }>(
        "/records?" +
          new URLSearchParams({
            page: String(page),
            page_size: "15",
            ...(q ? { q } : {}),
            ...(risk ? { risk } : {}),
            ...(language ? { language } : {}),
            ...(split ? { split } : {}),
          }),
      ),
    enabled: tab === "dataset",
  });
  return (
    <>
      <PageTitle
        eyebrow="РАБОЧЕЕ ПРОСТРАНСТВО"
        title="Материалы"
        description="Синтетическая база примеров и сохранённые рабочие дела."
      />
      <section className="content-panel library-panel">
        <div className="library-tabs">
          <button
            className={tab === "dataset" ? "active" : ""}
            onClick={() => setTab("dataset")}
          >
            База примеров <span>{stats.data?.total ?? "…"}</span>
          </button>
          <button
            className={tab === "cases" ? "active" : ""}
            onClick={() => setTab("cases")}
          >
            Рабочие дела <span>{cases?.length ?? "…"}</span>
          </button>
        </div>
        {tab === "dataset" ? (
          <>
            <div className="library-notice">
              <Icon name="info" size={16} />
              Все примеры синтетические. Они не являются реальными переписками
              или расследованиями.
            </div>
            <div className="filters">
              <div className="input-with-icon">
                <Icon name="search" size={17} />
                <input
                  aria-label="Поиск по тексту"
                  maxLength={100}
                  placeholder="Найти по тексту материала…"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <select
                aria-label="Риск"
                value={risk}
                onChange={(e) => {
                  setRisk(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Любой риск</option>
                {Object.entries(riskLabel).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                aria-label="Язык"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Все языки</option>
                {Object.keys(stats.data?.languages ?? {}).map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <select
                aria-label="Выборка"
                value={split}
                onChange={(e) => {
                  setSplit(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Все выборки</option>
                <option value="train">Обучающая</option>
                <option value="validation">Валидационная</option>
                <option value="test">Тестовая</option>
              </select>
            </div>
            {records.isPending ? (
              <div className="loading-state">Загружаем материалы…</div>
            ) : records.error ? (
              <ErrorNotice
                error={records.error}
                retry={() => void records.refetch()}
              />
            ) : !records.data.items.length ? (
              <Empty title="Ничего не найдено" icon="search">
                <p>Попробуйте другой запрос или измените фильтры.</p>
              </Empty>
            ) : (
              <div className="table-scroll">
                <table className="records-table">
                  <thead>
                    <tr>
                      <th>Материал</th>
                      <th>Текст предложения</th>
                      <th>Разметка риска</th>
                      <th>Выборка</th>
                      <th>
                        <span className="sr-only">Открыть</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.data.items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            className="record-link"
                            onClick={() => open(r)}
                          >
                            {r.id}
                          </button>
                          <small>{r.language.toUpperCase()}</small>
                        </td>
                        <td>
                          <button
                            className="table-text-button"
                            onClick={() => open(r)}
                          >
                            {r.text}
                          </button>
                        </td>
                        <td>
                          <Risk risk={r.risk_label} />
                        </td>
                        <td className="muted">{r.split}</td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={"Открыть " + r.id}
                            onClick={() => open(r)}
                          >
                            <Icon name="chevron" size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination">
              <span>
                Найдено: {records.data?.total ?? "…"} · страница {page}
              </span>
              <button
                className="secondary-button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Назад
              </button>
              <button
                className="secondary-button"
                disabled={!records.data || page * 15 >= records.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее →
              </button>
            </div>
          </>
        ) : (
          <>
            {casesPending ? (
              <div className="loading-state">Загружаем дела…</div>
            ) : casesError ? (
              <ErrorNotice error={casesError} retry={retryCases} />
            ) : cases?.length ? (
              <div className="table-scroll">
                <table className="records-table">
                  <thead>
                    <tr>
                      <th>Дело</th>
                      <th>Добавлено</th>
                      <th>Статус</th>
                      <th>Результат</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="record-link case-title"
                            onClick={() => open(c)}
                          >
                            {c.title}
                          </button>
                          <small>{origins[c.source_type]}</small>
                        </td>
                        <td>
                          {new Date(c.created_at).toLocaleString("ru-RU")}
                        </td>
                        <td>
                          <span className="status-pill">
                            {statuses[c.status]}
                          </span>
                        </td>
                        <td>
                          <Risk risk={c.analysis.risk_label} />
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={"Открыть дело " + c.title}
                            onClick={() => open(c)}
                          >
                            <Icon name="chevron" size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="case-empty">
                <p>Пока нет сохранённых дел.</p>
                <button className="secondary-button" onClick={createCase}>
                  <Icon name="plus" size={16} />
                  Создать дело
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
function Quality() {
  const query = useQuery({
    queryKey: ["evaluation"],
    queryFn: () => api<Evaluation>("/evaluate?split=test"),
  });
  const benchmark = useQuery({
    queryKey: ["benchmark-results"],
    queryFn: () => api<BenchmarkResult>("/quality/benchmark"),
  });
  const challenge = useQuery({
    queryKey: ["public-challenge"],
    queryFn: () => api<PublicChallengeResult>("/quality/public-challenge"),
  });
  const conversations = useQuery({
    queryKey: ["conversation-benchmark"],
    queryFn: () => api<ConversationBenchmarkResult>("/quality/conversations"),
  });
  const ocr = useQuery({
    queryKey: ["ocr-benchmark"],
    queryFn: () => api<OcrBenchmarkResult>("/quality/ocr"),
  });
  if (!query.data)
    return (
      <>
        <PageTitle
          eyebrow="ПРОВЕРКА КАЧЕСТВА"
          title="Что подтверждено тестированием"
          description="Измерения на синтетической тестовой выборке и отдельная проверка публичных источников."
        />
        {query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : (
          <div className="content-panel loading-state">
            Получаем результаты Python API…
          </div>
        )}
      </>
    );
  const r = query.data.risk_classification,
    m = query.data.mechanism_similarity;
  const metrics: [string, number, string][] = [
    [
      "Accuracy · три класса",
      r.accuracy_3class,
      "Доля верно определённых классов риска.",
    ],
    [
      "Precision · высокий риск",
      r.high_risk_precision,
      "Доля верных среди отнесённых к высокому риску.",
    ],
    [
      "Recall · высокий риск",
      r.high_risk_recall,
      "Доля обнаруженных среди всех примеров высокого риска.",
    ],
    [
      "False-positive rate",
      r.high_risk_false_positive_rate,
      "Доля остальных примеров, ошибочно отнесённых к высокому риску.",
    ],
    [
      "Pair precision",
      m.pair_precision,
      "Доля верных среди пар, признанных похожими.",
    ],
    ["Pair recall", m.pair_recall, "Доля обнаруженных похожих пар."],
    [
      "Pair false-positive rate",
      m.pair_false_positive_rate,
      "Доля разных механизмов, ошибочно признанных похожими.",
    ],
  ];
  const percent = (v: number | null | undefined) =>
    v == null ? "Не определено" : `${(v * 100).toFixed(1)}%`;
  return (
    <>
      <PageTitle
        eyebrow="ПРОВЕРКА КАЧЕСТВА"
        title="Что подтверждено тестированием"
        description={`Тестовая выборка: ${r.count} синтетических примеров. Результаты получены от Python API.`}
      />
      <div className="benchmark-warning">
        <Icon name="info" />
        <p>
          Синтетические измерения не показывают точность на реальных сообщениях.
          Публичный набор состоит из исследовательских пересказов официальных
          публикаций.
        </p>
      </div>
      <section className="content-panel">
        <div className="section-heading">
          <h2>Результаты тестирования</h2>
          <span className="source-badge">TEST SPLIT</span>
        </div>
        <div className="table-scroll">
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Метрика</th>
                <th>Результат</th>
                <th>Что означает</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(([name, v, desc]) => (
                <tr key={name}>
                  <th>{name}</th>
                  <td className="metric-value">{percent(v)}</td>
                  <td className="muted">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>OCR RU/KZ: финансовый смысл после распознавания</h2>
            <p className="muted">
              Шесть программно созданных изображений; исходный OCR измеряется
              отдельно от текста, который пользователь проверяет перед анализом.
            </p>
          </div>
          {ocr.data && (
            <span className="source-badge">{ocr.data.case_count} SYNTHETIC IMAGES</span>
          )}
        </div>
        {ocr.isPending ? (
          <div className="loading-state">Загружаем результат OCR…</div>
        ) : ocr.error ? (
          <ErrorNotice error={ocr.error} retry={() => void ocr.refetch()} />
        ) : (
          ocr.data && (
            <>
              <div className="table-scroll">
                <table className="metrics-table">
                  <thead>
                    <tr><th>Метрика</th><th>Сырой OCR</th><th>Текст для проверки</th></tr>
                  </thead>
                  <tbody>
                    <tr><th>Финансовые поля</th><td>{percent(ocr.data.raw_financial_field_accuracy)}</td><td className="metric-value">{percent(ocr.data.review_text_financial_field_accuracy)}</td></tr>
                    <tr><th>Точное совпадение сумм</th><td>{percent(ocr.data.raw_amount_exact_match)}</td><td className="metric-value">{percent(ocr.data.review_text_amount_exact_match)}</td></tr>
                    <tr><th>Сохранение символа ₸</th><td>{percent(ocr.data.raw_tenge_symbol_retention)}</td><td className="metric-value">{percent(ocr.data.review_text_tenge_symbol_retention)}</td></tr>
                    <tr><th>Казахские буквы</th><td colSpan={2}>{percent(ocr.data.kazakh_character_recall)}</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="muted benchmark-caption">
                Средние CER {percent(ocr.data.average_cer)} · WER {percent(ocr.data.average_wer)}.
                Исправляется только похожий на «Т» знак тенге рядом с числом; суммы не угадываются.
                Это лабораторная проверка, а не качество на реальных чатах.
              </p>
            </>
          )
        )}
      </section>
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Сопоставление структурного matcher и TF-IDF</h2>
            <p className="muted">
              Одинаковые пары синтетических материалов; vocabulary и порог
              TF-IDF обучены/выбраны только на train и validation.
            </p>
          </div>
        </div>
        {benchmark.isPending ? (
          <div className="loading-state">Загружаем сохранённый результат…</div>
        ) : benchmark.error ? (
          <ErrorNotice
            error={benchmark.error}
            retry={() => void benchmark.refetch()}
          />
        ) : (
          benchmark.data && (
            <>
              <div className="table-scroll">
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Метод</th>
                      <th>Порог</th>
                      <th>Precision</th>
                      <th>Recall</th>
                      <th>FPR</th>
                      <th>TP / FP / FN / TN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(benchmark.data.test_metrics_once).map(
                      ([name, item]) => (
                        <tr key={name}>
                          <th>
                            {name === "dna" ? "PYRAMID DNA" : "TF-IDF cosine"}
                          </th>
                          <td>{percent(item.threshold)}</td>
                          <td className="metric-value">
                            {percent(item.precision)}
                          </td>
                          <td>{percent(item.recall)}</td>
                          <td>{percent(item.fpr)}</td>
                          <td>
                            {item.confusion.tp} / {item.confusion.fp} /{" "}
                            {item.confusion.fn} / {item.confusion.tn}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="muted benchmark-caption">
                Test: {benchmark.data.pairs.test.positive} положительных и{" "}
                {benchmark.data.pairs.test.negative} отрицательных пар ·
                validation thresholds · seed {benchmark.data.seed} · механизмные
                группы без пересечений: {benchmark.data.mechanism_leakage_check}
                .
              </p>
            </>
          )
        )}
      </section>
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Переписки: инженерная проверка</h2>
            <p className="muted">
              Синтетические переписки проверяют разделение сообщений,
              восстановление условий и ложные объединения.
            </p>
          </div>
          {conversations.data && (
            <span className="source-badge">
              {conversations.data.case_count} SYNTHETIC CASES
            </span>
          )}
        </div>
        {conversations.isPending ? (
          <div className="loading-state">Загружаем проверку переписок…</div>
        ) : conversations.error ? (
          <ErrorNotice
            error={conversations.error}
            retry={() => void conversations.refetch()}
          />
        ) : (
          conversations.data && (
            <>
              <div className="table-scroll">
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Метрика</th>
                      <th>Результат</th>
                      <th>Область проверки</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Число механизмов</th>
                      <td className="metric-value">
                        {percent(conversations.data.mechanism_count_accuracy)}
                      </td>
                      <td>Верно выделено 0, 1 или 2 механизма.</td>
                    </tr>
                    <tr>
                      <th>Финансовые поля</th>
                      <td className="metric-value">
                        {percent(conversations.data.feature_accuracy)}
                      </td>
                      <td>
                        Взнос, выплата, срок и приглашения в размеченных
                        случаях.
                      </td>
                    </tr>
                    <tr>
                      <th>Связь доказательств</th>
                      <td className="metric-value">
                        {percent(conversations.data.evidence_link_accuracy)}
                      </td>
                      <td>
                        Каждый диапазон точно относится к исходному сообщению.
                      </td>
                    </tr>
                    <tr>
                      <th>False Mechanism Merge Rate</th>
                      <td className="metric-value">
                        {percent(conversations.data.false_mechanism_merge_rate)}
                      </td>
                      <td>
                        {conversations.data.false_merge_cases} случая с двумя
                        независимыми предложениями.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="muted benchmark-caption">
                Только синтетические инженерные сценарии, не реальные чаты и не
                оценка полевой точности.
              </p>
            </>
          )
        )}
      </section>
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Открытые кейсы АФМ</h2>
            <p className="muted">
              Подготовленные по официальным публикациям пересказы, не исходные
              сообщения соцсетей.
            </p>
          </div>
          {challenge.data && (
            <span className="source-badge">DIAGNOSTIC / DEVELOPMENT</span>
          )}
        </div>
        {challenge.isPending ? (
          <div className="loading-state">Загружаем диагностический отчёт…</div>
        ) : challenge.error ? (
          <ErrorNotice
            error={challenge.error}
            retry={() => void challenge.refetch()}
          />
        ) : (
          challenge.data && (
            <>
              <p className="muted">
                Извлечено {challenge.data.extraction_coverage.correct_checks} из{" "}
                {challenge.data.extraction_coverage.evaluated_checks} явно
                размеченных признаков в {challenge.data.case_count} пересказах (
                {percent(challenge.data.extraction_coverage.rate)}). Поля без
                упоминания не считались отрицательными.
              </p>
              <div className="table-scroll">
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>Признак</th>
                      <th>Покрытие</th>
                      <th>Ошибки</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(challenge.data.per_feature).map(
                      ([name, item]) => (
                        <tr key={name}>
                          <th>{labels[name] ?? name}</th>
                          <td>
                            {item.correct}/{item.evaluated} ·{" "}
                            {percent(item.coverage)}
                          </td>
                          <td>
                            {item.failures.length
                              ? item.failures.join(", ")
                              : "Нет в оценённых случаях"}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <div className="challenge-sources">
                <p className="muted">Случаи с пропущенными метками:</p>
                {challenge.data.per_case
                  .filter((c) => !c.all_expected_features_extracted)
                  .slice(0, 3)
                  .map((c) => (
                    <a
                      key={c.id}
                      href={c.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.id} ·{" "}
                      {c.checks
                        .filter((x) => !x.correct)
                        .map((x) => labels[x.feature] ?? x.feature)
                        .join(", ")}{" "}
                      ↗
                    </a>
                  ))}
              </div>
              <p className="muted benchmark-caption">
                Development/diagnostic, не независимая blind-проверка и не
                точность на исходных сообщениях. Engine SHA-256:{" "}
                <code>{challenge.data.engine_sha256.slice(0, 16)}…</code>
              </p>
            </>
          )
        )}
      </section>
      <section className="content-panel">
        <div className="section-heading">
          <div>
            <h2>Матрица ошибок</h2>
            <p className="muted">
              Строки — разметка; столбцы — прогноз движка.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="confusion-table">
            <thead>
              <tr>
                <th>Разметка / прогноз</th>
                {["low", "medium", "high"].map((k) => (
                  <th key={k}>{riskLabel[k]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.confusion_matrix_gold_rows).map(
                ([gold, preds]) => (
                  <tr key={gold}>
                    <th>{riskLabel[gold]}</th>
                    {["low", "medium", "high"].map((k) => (
                      <td className={gold === k ? "correct-cell" : ""} key={k}>
                        {preds[k]}
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        <p className="muted benchmark-caption">
          Сопоставление: {m.positive_pairs} положительных и {m.negative_pairs}{" "}
          отрицательных пар. Порог: {percent(m.threshold)}.
        </p>
      </section>
    </>
  );
}
function Method() {
  return (
    <>
      <PageTitle
        eyebrow="МЕТОДИКА"
        title="От исходного фрагмента к проверяемому выводу"
        description="Python-движок сохраняет связь между распознанными условиями, структурным сравнением и оценкой по правилам."
      />
      <section className="content-panel method-panel">
        <div className="method-step">
          <span>01</span>
          <div>
            <h3>Извлечение финансовых условий</h3>
            <p>
              Нормализация RU/KZ текста, обнаружение сумм с валютой, диапазонов,
              процентов, сроков и формулировок о взносе или привлечении.
              Денежная сумма и требование внести средства извлекаются раздельно.
            </p>
          </div>
        </div>
        <div className="method-step">
          <span>02</span>
          <div>
            <h3>Построение структурного отпечатка</h3>
            <p>
              Суммы связываются с ближайшим контекстом: взносом, обещанной
              выплатой, пакетом или вознаграждением за приглашение. Неизвестные
              роли остаются неизвестными; валюты не пересчитываются.
            </p>
          </div>
        </div>
        <div className="method-step">
          <span>03</span>
          <div>
            <h3>Сопоставление финансовых механизмов</h3>
            <p>
              Существующий matcher сравнивает финансовые признаки и числовые
              условия. Ненайденные данные не считаются совпадением, а доли в
              таблице показывают вклад в итоговый показатель.
            </p>
          </div>
        </div>
        <div className="method-step">
          <span>04</span>
          <div>
            <h3>Расчёт оценки риска</h3>
            <p>
              Действующие правила начисляют баллы за сочетания взноса, выплаты,
              гарантии, привлечения, срочности и других признаков. Итог
              ограничен 100 баллами и не является вероятностью правонарушения.
            </p>
          </div>
        </div>
        <div className="method-step">
          <span>05</span>
          <div>
            <h3>Интерпретация результата</h3>
            <p>
              Подсвеченные отрезки пришли из Python с позициями в исходном
              тексте. Это объяснимые сигналы для проверки человеком, не
              подтверждение преступления или общей личности организатора.
            </p>
          </div>
        </div>
        <p className="method-limit-note">
          Тестовая база синтетическая; публичные кейсы — исследовательские
          пересказы официальных публикаций, не исходные сообщения соцсетей.
          Любой вывод требует проверки человеком.{" "}
          <a href="#/quality">Результаты тестирования</a>.
        </p>
      </section>
    </>
  );
}

type CasePayload = {
  title: string;
  text: string;
  source_type: string;
  source_url: string;
  status: string;
  notes: string;
};
function CaseForm({
  open,
  item,
  initialText,
  pending,
  error,
  close,
  save,
}: {
  open: boolean;
  item?: CaseItem;
  initialText: string;
  pending: boolean;
  error?: Error;
  close: () => void;
  save: (p: CasePayload) => void;
}) {
  const [payload, setPayload] = useState<CasePayload>({
    title: "",
    text: "",
    source_type: "other",
    source_url: "",
    status: "new",
    notes: "",
  });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (open) {
      setPayload({
        title: item?.title ?? "Новая проверка",
        text: item?.text ?? initialText,
        source_type: item?.source_type ?? "other",
        source_url: item?.source_url ?? "",
        status: item?.status ?? "new",
        notes: item?.notes ?? "",
      });
      setDirty(false);
    }
  }, [open, item, initialText]);
  function field(key: keyof CasePayload, v: string) {
    setPayload((p) => ({ ...p, [key]: v }));
    setDirty(true);
  }
  function cancel() {
    if (!dirty || confirm("Закрыть без сохранения изменений?")) close();
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    save(payload);
  }
  return (
    <Modal
      open={open}
      close={cancel}
      title={item ? "Редактировать дело" : "Сохранить проверку в дело"}
    >
      <form className="case-form" onSubmit={submit}>
        <p className="muted">
          Сохранится исходный текст, его хеш, результат анализа и ваши заметки.
          В веб-версии база SQLite хранится в этом браузере и не
          синхронизируется между устройствами.
        </p>
        <label>
          Название дела
          <input
            data-autofocus
            required
            maxLength={200}
            value={payload.title}
            onChange={(e) => field("title", e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Происхождение
            <select
              aria-label="Происхождение"
              value={payload.source_type}
              onChange={(e) => field("source_type", e.target.value)}
            >
              {Object.entries(origins).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Статус
            <select
              aria-label="Статус дела"
              value={payload.status}
              onChange={(e) => field("status", e.target.value)}
            >
              {Object.entries(statuses).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Ссылка на источник <span>необязательно</span>
          <input
            type="url"
            maxLength={2000}
            placeholder="https://…"
            value={payload.source_url}
            onChange={(e) => field("source_url", e.target.value)}
          />
        </label>
        <label>
          Исходный текст
          <textarea
            required
            minLength={3}
            maxLength={10000}
            value={payload.text}
            onChange={(e) => field("text", e.target.value)}
          />
        </label>
        <label>
          Заметки аналитика
          <textarea
            maxLength={10000}
            placeholder="Что нужно уточнить или проверить вручную?"
            value={payload.notes}
            onChange={(e) => field("notes", e.target.value)}
          />
        </label>
        {error && <ErrorNotice error={error} />}
        <div className="form-footer">
          <button type="button" className="secondary-button" onClick={cancel}>
            Отмена
          </button>
          <button
            className="primary-button"
            disabled={
              pending || !payload.title.trim() || payload.text.trim().length < 3
            }
          >
            <Icon name="save" size={17} />
            {pending ? "Сохраняем…" : "Сохранить дело"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20000 } },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
