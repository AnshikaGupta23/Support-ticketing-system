import { useState, useEffect } from 'react';
import api from '../api';

const DOCS_LIST = [
  { id: 'submission', title: 'Submission Details', path: '/docs/submission' },
  { id: 'architecture', title: 'Architecture Blueprint', path: '/docs/architecture' },
  { id: 'schema', title: 'Database Schema & Triggers', path: '/docs/schema' },
  { id: 'plan', title: 'Plan & Hours Budget', path: '/docs/plan' },
  { id: 'decisions', title: 'Architectural Decisions', path: '/docs/decisions' },
  { id: 'ai-prompts', title: 'AI Engineering Prompt Log', path: '/docs/ai-prompts' },
];

const DocsViewerModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('submission');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const doc = DOCS_LIST.find((d) => d.id === activeTab);
    if (doc) {
      setLoading(true);
      api
        .get(doc.path, { responseType: 'text' })
        .then((res) => setContent(res.data))
        .catch((err) => setContent(`Error loading document: ${err.response?.data?.error || err.message}`))
        .finally(() => setLoading(false));
    }
  }, [activeTab, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '900px', width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>📖 System Architectural Documentation</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            ✕ Close
          </button>
        </div>

        {/* Tabs navigation */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem', overflowX: 'auto' }}>
          {DOCS_LIST.map((doc) => (
            <button
              key={doc.id}
              className={`btn ${activeTab === doc.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => setActiveTab(doc.id)}
            >
              {doc.title}
            </button>
          ))}
        </div>

        {/* Content Viewer */}
        <div style={{ background: 'var(--bg-main)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', maxHeight: '60vh', overflowY: 'auto' }}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading documentation file...</p>
          ) : (
            <pre style={{ fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: '1.6' }}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocsViewerModal;
