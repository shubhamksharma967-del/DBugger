import React, { useState } from 'react';
import { FiShield, FiChevronDown, FiChevronUp } from 'react-icons/fi';

/**
 * Shows what was stripped out of a log before it was sent to the AI.
 * Renders nothing if nothing was redacted — keeps the UI quiet on
 * clean logs and only speaks up when it actually did something.
 *
 * Usage:
 *   const { redactedText, summary } = redactText(rawLog);
 *   <RedactionSummary summary={summary} />
 */
export default function RedactionSummary({ summary }) {
  const [open, setOpen] = useState(false);
  if (!summary || summary.totalRedactions === 0) return null;

  const entries = Object.entries(summary.byCategory);

  return (
    <div style={styles.wrap}>
      <button style={styles.header} onClick={() => setOpen(!open)}>
        <FiShield style={styles.icon} />
        <span style={styles.headline}>
          {summary.totalRedactions} sensitive item{summary.totalRedactions !== 1 ? 's' : ''} redacted before AI analysis
        </span>
        {open ? <FiChevronUp /> : <FiChevronDown />}
      </button>
      {open && (
        <ul style={styles.list}>
          {entries.map(([label, count]) => (
            <li key={label} style={styles.listItem}>
              <span>{label}</span>
              <span style={styles.count}>{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    background: '#0f1c1a',
    border: '1px solid #1e3a34',
    borderRadius: 8,
    margin: '8px 0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 13,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#6ee7b7',
    textAlign: 'left',
  },
  icon: { flexShrink: 0, color: '#34d399' },
  headline: { flex: 1, fontWeight: 500 },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '4px 12px 10px 36px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#9ca3af',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  },
  count: { color: '#6ee7b7' },
};
