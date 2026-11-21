import { useEffect, useState } from 'react';
import type { RuleVariant } from '../engine';
import { useI18n } from '../i18n';
import type { RuleBullet } from '../i18n';

export interface RulesModalProps {
  open: boolean;
  initialVariant: RuleVariant;
  onClose: () => void;
}

type RulesTab = 'wallgo1' | 'wallgo2' | 'scoring';

function RulesBulletList({ items }: { items: readonly RuleBullet[] }) {
  return (
    <ul className="rules-list">
      {items.map((item) => (
        <li key={item.lead}>
          <strong>{item.lead}</strong>: {item.body}
          {item.emphasis && <strong>{item.emphasis}</strong>}
          {item.bodyAfter}
        </li>
      ))}
    </ul>
  );
}

export function RulesModal({ open, initialVariant, onClose }: RulesModalProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<RulesTab>(initialVariant);

  useEffect(() => {
    if (open) {
      setActiveTab(initialVariant);
    }
  }, [open, initialVariant]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        data-testid="rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="rules-modal-title" className="modal-title">
              {t.rules.title}
            </h2>
            <p className="modal-subtitle">{t.rules.subtitle}</p>
          </div>
          <button
            type="button"
            className="btn-modal-close"
            data-testid="rules-close-button"
            aria-label={t.rules.closeAria}
            onClick={onClose}
          >
            {t.common.close}
          </button>
        </header>

        <div className="rules-tabs" role="tablist" aria-label={t.rules.tabsAria}>
          <button
            type="button"
            role="tab"
            className="rules-tab"
            data-testid="rules-tab-wallgo1"
            aria-selected={activeTab === 'wallgo1'}
            onClick={() => setActiveTab('wallgo1')}
          >
            {t.rules.tabWallGo1}
          </button>
          <button
            type="button"
            role="tab"
            className="rules-tab"
            data-testid="rules-tab-wallgo2"
            aria-selected={activeTab === 'wallgo2'}
            onClick={() => setActiveTab('wallgo2')}
          >
            {t.rules.tabWallGo2}
          </button>
          <button
            type="button"
            role="tab"
            className="rules-tab"
            data-testid="rules-tab-scoring"
            aria-selected={activeTab === 'scoring'}
            onClick={() => setActiveTab('scoring')}
          >
            {t.rules.tabScoring}
          </button>
        </div>

        <div className="modal-body" role="tabpanel">
          {activeTab === 'wallgo1' && (
            <div className="rules-section">
              <RulesBulletList items={t.rules.wg1Items} />
            </div>
          )}

          {activeTab === 'wallgo2' && (
            <div className="rules-section">
              <div className="rules-diagrams">
                <div className="rules-diagram-card">
                  <svg
                    width="78"
                    height="78"
                    viewBox="0 0 80 80"
                    fill="none"
                    role="img"
                    aria-label={t.rules.wg2DiagramSquareAria}
                  >
                    <title>{t.rules.wg2DiagramSquareSvgTitle}</title>
                    <rect
                      x="2"
                      y="2"
                      width="76"
                      height="76"
                      rx="10"
                      fill="#F7F3EA"
                      stroke="#D4C7B2"
                    />
                    <rect x="30" y="30" width="20" height="20" rx="4" fill="#C84B31" />
                    <path
                      d="M40 26V10M40 54V70M26 40H10M54 40H70"
                      stroke="#C48320"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <circle cx="40" cy="12" r="3" fill="#C48320" />
                    <circle cx="40" cy="68" r="3" fill="#C48320" />
                    <circle cx="12" cy="40" r="3" fill="#C48320" />
                    <circle cx="68" cy="40" r="3" fill="#C48320" />
                  </svg>
                  <span className="rules-diagram-title">
                    {t.rules.wg2DiagramSquareTitle}
                  </span>
                  <span className="rules-diagram-desc">
                    {t.rules.wg2DiagramSquareDesc}
                  </span>
                </div>
                <div className="rules-diagram-card">
                  <svg
                    width="78"
                    height="78"
                    viewBox="0 0 80 80"
                    fill="none"
                    role="img"
                    aria-label={t.rules.wg2DiagramRoundAria}
                  >
                    <title>{t.rules.wg2DiagramRoundSvgTitle}</title>
                    <rect
                      x="2"
                      y="2"
                      width="76"
                      height="76"
                      rx="10"
                      fill="#F7F3EA"
                      stroke="#D4C7B2"
                    />
                    <circle cx="40" cy="40" r="10" fill="#2B5F8F" />
                    <path
                      d="M40 28V20H54M40 28V20H26M40 52V60H54M40 52V60H26"
                      stroke="#C48320"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="56" cy="20" r="3" fill="#C48320" />
                    <circle cx="24" cy="20" r="3" fill="#C48320" />
                    <circle cx="56" cy="60" r="3" fill="#C48320" />
                    <circle cx="24" cy="60" r="3" fill="#C48320" />
                  </svg>
                  <span className="rules-diagram-title">
                    {t.rules.wg2DiagramRoundTitle}
                  </span>
                  <span className="rules-diagram-desc">
                    {t.rules.wg2DiagramRoundDesc}
                  </span>
                </div>
              </div>
              <RulesBulletList items={t.rules.wg2Items} />
            </div>
          )}

          {activeTab === 'scoring' && (
            <div className="rules-section">
              <RulesBulletList items={t.rules.scoringItems} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
