// OwlLuna's own controls: card menus, sheets, stamp alerts, the segmented picker and the Slab switch.

import { Check, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { dismissNotice, useApp } from "../state/app";

export function IconButton(props: {
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  on?: boolean;
  disabled?: boolean;
  tone?: "tomato";
  children: ReactNode;
  testid?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${props.on ? " on" : ""}${props.tone ? " " + props.tone : ""}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.on}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testid}
      style={props.style}
    >
      {props.children}
    </button>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === props.value} onClick={() => props.onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slab(props: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="slab" aria-checked={props.checked} aria-label={props.label} disabled={props.disabled} onClick={() => props.onChange(!props.checked)} />;
}

export function SearchField(props: { value: string; onChange: (value: string) => void; placeholder: string; autoFocus?: boolean; onEnter?: (shift: boolean) => void; onEscape?: () => void; testid?: string }) {
  return (
    <div className="search-field grow">
      <Search />
      <input
        className="field"
        type="search"
        value={props.value}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        data-testid={props.testid}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.onEnter?.(event.shiftKey);
          // Escape clears the field, then leaves it.
          if (event.key === "Escape") {
            event.stopPropagation();
            if (props.value) props.onChange("");
            else {
              (event.target as HTMLInputElement).blur();
              props.onEscape?.();
            }
          }
        }}
      />
    </div>
  );
}

function Portal(props: { children: ReactNode }) {
  return createPortal(props.children, document.body);
}

export interface MenuAnchor {
  x: number;
  y: number;
  /** The menu opens above the point when there is more room there, and always when this is "up". */
  prefer?: "up" | "down";
}

export function anchorBelow(element: Element, align: "start" | "end" = "start"): MenuAnchor {
  const rect = element.getBoundingClientRect();
  return { x: align === "start" ? rect.left : rect.right, y: rect.bottom + 4 };
}

export function anchorAbove(element: Element): MenuAnchor {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top - 6, prefer: "up" };
}

/** A card menu at a point of the window, kept on screen. Closes on a click outside or Escape. */
export function Menu(props: { anchor: MenuAnchor; title?: string; onClose: () => void; children: ReactNode; width?: number; centered?: boolean; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    let left = props.centered || props.anchor.prefer === "up" ? props.anchor.x - width / 2 : props.anchor.x;
    if (left + width > window.innerWidth - 8) left = props.centered ? window.innerWidth - width - 8 : Math.min(props.anchor.x - width, window.innerWidth - width - 8);
    left = Math.max(8, left);
    let top = props.anchor.y;
    if (props.anchor.prefer === "up" || top + height > window.innerHeight - 8) top = Math.max(8, props.anchor.prefer === "up" ? props.anchor.y - height : window.innerHeight - height - 8);
    setPosition({ left, top });
  }, [props.anchor.x, props.anchor.y, props.anchor.prefer, props.centered, props.children]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props.onClose]);
  return (
    <Portal>
      <div className="scrim" onPointerDown={props.onClose} onContextMenu={(event) => { event.preventDefault(); props.onClose(); }} />
      <div
        ref={ref}
        className="menu"
        role="menu"
        data-testid={props.testid}
        style={{ left: position?.left ?? -9999, top: position?.top ?? -9999, width: props.width, visibility: position ? "visible" : "hidden" }}
      >
        {props.title && <div className="menu-band cloth">{props.title}</div>}
        <div className="menu-rows">{props.children}</div>
      </div>
    </Portal>
  );
}

export function MenuRow(props: { onClick: () => void; icon?: ReactNode; children: ReactNode; keys?: string; chosen?: boolean; destructive?: boolean; disabled?: boolean; testid?: string }) {
  return (
    <button type="button" role="menuitem" className={`menu-row${props.destructive ? " destructive" : ""}`} disabled={props.disabled} onClick={props.onClick} data-testid={props.testid}>
      {props.icon}
      <span className="truncate">{props.children}</span>
      {props.chosen && <Check className="check" />}
      {props.keys && <span className="keys">{props.keys}</span>}
    </button>
  );
}

export function MenuBreak() {
  return <div className="menu-break" role="separator" />;
}

/** A sheet over the app. Escape and a click on the scrim close it. */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean; testid?: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <Portal>
      <div className="scrim dim" onPointerDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
        <div className={`sheet${props.wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title} data-testid={props.testid}>
          <div className="sheet-head">
            <h2 className="grow">{props.title}</h2>
            <IconButton label="Close" onClick={props.onClose}><X /></IconButton>
          </div>
          <div className="sheet-body">{props.children}</div>
          {props.foot && <div className="sheet-foot">{props.foot}</div>}
        </div>
      </div>
    </Portal>
  );
}

// Stamp alerts: every alert and confirmation. Cancel first, the main button last.

interface StampRequest {
  title: string;
  message?: string;
  confirm: string;
  destructive?: boolean;
  /** A line of text to ask for, with what it starts as. */
  prompt?: { value: string; placeholder?: string; password?: boolean };
  resolve: (answer: string | boolean) => void;
}

const useStamp = create<{ request: StampRequest | null }>(() => ({ request: null }));

export function confirm(options: { title: string; message?: string; confirm: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useStamp.setState({ request: { ...options, resolve: (answer) => resolve(answer !== false) } }));
}

/** Asks for a line of text. Null when cancelled. */
export function ask(options: { title: string; message?: string; confirm: string; value?: string; placeholder?: string; password?: boolean }): Promise<string | null> {
  return new Promise((resolve) => useStamp.setState({
    request: {
      title: options.title, message: options.message, confirm: options.confirm,
      prompt: { value: options.value ?? "", placeholder: options.placeholder, password: options.password },
      resolve: (answer) => resolve(typeof answer === "string" ? answer : null),
    },
  }));
}

export function StampHost() {
  const request = useStamp((state) => state.request);
  const [text, setText] = useState("");
  useEffect(() => setText(request?.prompt?.value ?? ""), [request]);
  if (!request) return null;
  const answer = (value: string | boolean) => {
    useStamp.setState({ request: null });
    request.resolve(value);
  };
  const accept = () => answer(request.prompt ? text : true);
  return (
    <Portal>
      <div className="scrim dim" style={{ zIndex: 1000 }} onKeyDown={(event) => { if (event.key === "Escape") answer(false); }}>
        <div className="stamp" role="alertdialog" aria-modal="true" aria-label={request.title} data-testid="stamp">
          <div className={`stamp-edge cloth${request.destructive ? " destructive" : ""}`} />
          <form className="stamp-body" onSubmit={(event) => { event.preventDefault(); accept(); }}>
            <h2>{request.title}</h2>
            {request.message && <p className="secondary">{request.message}</p>}
            {request.prompt && (
              <input
                className="field"
                autoFocus
                type={request.prompt.password ? "password" : "text"}
                value={text}
                placeholder={request.prompt.placeholder}
                onChange={(event) => setText(event.target.value)}
                onFocus={(event) => event.target.select()}
                data-testid="stamp-input"
              />
            )}
            <div className="stamp-actions">
              <button type="button" className="btn flat" onClick={() => answer(false)} data-testid="stamp-cancel">Cancel</button>
              <button type="submit" className={`btn ${request.destructive ? "destructive" : "primary"}`} autoFocus={!request.prompt} data-testid="stamp-confirm">{request.confirm}</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}

export function Notices() {
  const notices = useApp((state) => state.notices);
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="status">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice plate${notice.tone === "trouble" ? " trouble" : ""}`} data-testid="notice">
          <span>{notice.message}</span>
          {notice.action && (
            <button type="button" className="btn small flat" onClick={() => { notice.action!.run(); dismissNotice(notice.id); }}>{notice.action.label}</button>
          )}
          <IconButton label="Dismiss" onClick={() => dismissNotice(notice.id)}><X /></IconButton>
        </div>
      ))}
    </div>
  );
}

export function EmptyPlate(props: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-plate">
      <div className="symbol">{props.icon}</div>
      <h3>{props.title}</h3>
      {props.children && <p>{props.children}</p>}
    </div>
  );
}

export function Thread(props: { value: number; label: string }) {
  return (
    <div className="thread" role="progressbar" aria-label={props.label} aria-valuenow={Math.round(props.value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.min(Math.max(props.value, 0), 1) * 100}%` }} />
    </div>
  );
}

/** Whether the app is shown dark, following Settings and the system. */
export function useDark(): boolean {
  const appearance = useApp((state) => state.settings.appearance);
  const [system, setSystem] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return appearance === "dark" || (appearance === "system" && system);
}
