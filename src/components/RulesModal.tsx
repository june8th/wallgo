import { useEffect, useState } from 'react';
import type { RuleVariant } from '../engine';

export interface RulesModalProps {
  open: boolean;
  initialVariant: RuleVariant;
  onClose: () => void;
}

type RulesTab = 'wallgo1' | 'wallgo2' | 'scoring';

export function RulesModal({ open, initialVariant, onClose }: RulesModalProps) {
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
              벽바둑 규칙 요약
            </h2>
            <p className="modal-subtitle">데블스 플랜 시즌 2 · 시즌 3 공식 룰 기준</p>
          </div>
          <button
            type="button"
            className="btn-modal-close"
            data-testid="rules-close-button"
            aria-label="규칙 닫기"
            onClick={onClose}
          >
            닫기
          </button>
        </header>

        <div className="rules-tabs" role="tablist" aria-label="규칙 탭">
          <button
            type="button"
            role="tab"
            className="rules-tab"
            data-testid="rules-tab-wallgo1"
            aria-selected={activeTab === 'wallgo1'}
            onClick={() => setActiveTab('wallgo1')}
          >
            벽바둑 (시즌 2)
          </button>
          <button
            type="button"
            role="tab"
            className="rules-tab"
            data-testid="rules-tab-wallgo2"
            aria-selected={activeTab === 'wallgo2'}
            onClick={() => setActiveTab('wallgo2')}
          >
            벽바둑 II (시즌 3)
          </button>
          <button
            type="button"
            role="tab"
            className="rules-tab"
            data-testid="rules-tab-scoring"
            aria-selected={activeTab === 'scoring'}
            onClick={() => setActiveTab('scoring')}
          >
            영역 · 감옥매치
          </button>
        </div>

        <div className="modal-body" role="tabpanel">
          {activeTab === 'wallgo1' && (
            <div className="rules-section">
              <ul className="rules-list">
                <li>
                  <strong>초기 배치</strong>: 7×7 보드에서 3인전은 각자 말 2개를 스네이크 순서(1→2→3→3→2→1)로 자유 배치합니다.
                </li>
                <li>
                  <strong>이동 (0~2칸)</strong>: 자신의 말 1개를 상하좌우로 0~2칸 움직입니다. 2칸 이동은 직선·90° 꺾기 모두 가능하며, 벽이나 다른 말은 통과할 수 없습니다.
                </li>
                <li>
                  <strong>제자리 유지 조건</strong>: 1칸 이상 이동할 수 있는 인접 빈 칸이 있을 때만 제자리(0칸)를 선택할 수 있습니다. 사방이 막힌 말은 제자리 벽 설치가 불가합니다.
                </li>
                <li>
                  <strong>필수 벽 설치</strong>: 이동을 마친 말의 상하좌우 빈 내부 변 중 1곳에 반드시 벽을 세웁니다. 세운 벽은 모든 플레이어를 동일하게 막습니다.
                </li>
                <li>
                  <strong>벽 부수기 (3인전 1인 1회)</strong>: 내 말과 맞닿은 내부 벽 1개를 부순 뒤, 해당 말로 정상 이동하고 도착 칸에 새 벽을 세웁니다.
                </li>
              </ul>
            </div>
          )}

          {activeTab === 'wallgo2' && (
            <div className="rules-section">
              <div className="rules-diagrams">
                <div className="rules-diagram-card">
                  <svg width="78" height="78" viewBox="0 0 80 80" fill="none" aria-hidden="true">
                    <rect x="2" y="2" width="76" height="76" rx="10" fill="#F7F3EA" stroke="#D4C7B2" />
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
                  <span className="rules-diagram-title">사각 말 (직선 1~2칸)</span>
                  <span className="rules-diagram-desc">한 방향으로 곧게 1~2칸 이동 · 꺾기 불가</span>
                </div>
                <div className="rules-diagram-card">
                  <svg width="78" height="78" viewBox="0 0 80 80" fill="none" aria-hidden="true">
                    <rect x="2" y="2" width="76" height="76" rx="10" fill="#F7F3EA" stroke="#D4C7B2" />
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
                  <span className="rules-diagram-title">원형 말 (1칸 · 90° 꺾기)</span>
                  <span className="rules-diagram-desc">상하좌우 1칸 또는 꺾어서 대각선 1칸 · 직진 2칸 불가</span>
                </div>
              </div>
              <ul className="rules-list">
                <li>
                  <strong>말 구성</strong>: 3인전은 각자 사각 말 1개 + 원형 말 1개로 시작하며, 첫 배치 때 원하는 말 종류를 고릅니다.
                </li>
                <li>
                  <strong>제자리 이동 불가</strong>: 반드시 1칸 이상 움직여야 합니다.
                </li>
                <li>
                  <strong>경로 벽 부수기 (3인전 1인 1회)</strong>: 이동 경로 위에 가로막힌 내부 벽 1개를 부수고 통과한 뒤 도착 칸에 새 벽을 세웁니다.
                </li>
              </ul>
            </div>
          )}

          {activeTab === 'scoring' && (
            <div className="rules-section">
              <ul className="rules-list">
                <li>
                  <strong>확보 영역 계산</strong>: 벽으로 완전히 둘러싸인 구역 안에 내 말만 존재하면 그 구역의 모든 칸(말이 선 칸 포함)이 내 점수가 됩니다.
                </li>
                <li>
                  <strong>즉시 종료 & 자동 패스</strong>: 모든 플레이어의 공간이 벽으로 분리되면 미사용 벽 부수기가 남아 있어도 즉시 종료됩니다. 아직 경기 중이지만 내 말이 모두 영역 확정(벽 부수기 소진) 상태라면 내 차례는 자동 패스됩니다.
                </li>
                <li>
                  <strong>교착 예외</strong>: 여러 플레이어의 말이 함께 갇혀 누구도 움직일 수 없는 구역은 각 말이 서 있는 칸 1칸씩만 점수로 인정합니다.
                </li>
                <li>
                  <strong>동률 판정</strong>: 총 칸 수가 같으면 <strong>가장 넓은 단일 영역</strong> 크기로 순위를 가립니다.
                </li>
                <li>
                  <strong>감옥매치 2라운드 (1:1)</strong>: 3인전 종료 후 하위 2명이 각자 말 4개(대각선 2개 고정 + 2개 배치, 벽 부수기 없음)로 1:1 결승을 바로 이어할 수 있습니다.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
