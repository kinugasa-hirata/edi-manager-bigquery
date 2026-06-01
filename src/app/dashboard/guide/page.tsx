'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth-context'

// ── Small UI helpers ──────────────────────────────────────────────────────────
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-600 leading-relaxed">{children}</p>
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700 leading-relaxed">
      💡 {children}
    </div>
  )
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700 leading-relaxed">
      ⚡ {children}
    </div>
  )
}
function Behind({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600 leading-relaxed">
      <span className="font-semibold text-gray-700">🔧 内部処理: </span>{children}
    </div>
  )
}
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 items-start">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-800 text-white text-[10px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <span className="text-xs text-gray-600 leading-relaxed">{children}</span>
    </div>
  )
}
function Formula({ lines }: { lines: { text: string; color?: string }[] }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-xs space-y-0.5">
      {lines.map((l, i) => (
        <p key={i} className={l.color ?? 'text-gray-700'}>{l.text}</p>
      ))}
    </div>
  )
}

function GuideSection({ icon, title, badge, children }: {
  icon: string; title: string; badge?: string; children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className="text-base flex-shrink-0">{icon}</span>
        <span className="flex-1 text-sm font-semibold text-gray-800">{title}</span>
        {badge && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 mr-1">
            {badge}
          </span>
        )}
        <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 bg-white border-t border-gray-50 space-y-3 text-xs text-gray-600 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GuidePage() {
  const { isEditor, isGuest } = useAuth()
  const isAdmin = !isEditor && !isGuest

  return (
    <div className="h-full overflow-auto p-5 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-5">
        <h2 className="text-lg font-bold text-gray-900">使い方ガイド</h2>
        <p className="text-xs text-gray-400 mt-0.5">EDI Manager — 機能と操作の詳細説明</p>
      </div>

      {/* Role badge */}
      <div className={`mb-5 px-3 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 ${
        isGuest   ? 'bg-gray-100 text-gray-600' :
        isEditor  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                    'bg-blue-50 text-blue-700 border border-blue-100'
      }`}>
        <span className="text-base">{isGuest ? '👁' : isEditor ? '🏭' : '🔑'}</span>
        <div>
          <p className="font-semibold">
            {isGuest  ? 'ゲスト閲覧モード' :
             isEditor ? '製造担当者モード' :
                        '管理者モード'}
          </p>
          <p className="font-normal opacity-80">
            {isGuest  ? 'ダッシュボードと原材料ページのみ閲覧できます' :
             isEditor ? '閲覧・製造計画入力・注文データ出力が可能です' :
                        'すべての機能（EDIアップロード・マスタ管理・設定変更）を利用できます'}
          </p>
        </div>
      </div>

      <div className="space-y-2">

        {/* ══ 0. システム全体像 ══════════════════════════════════════════════ */}
        <GuideSection icon="🗺️" title="システム全体の目的と構成">
          <P>
            クライアントからEDI（電子データ交換）で届く受注情報をもとに、各製品の在庫・製造計画・原材料の
            三つを組み合わせて「いつ・どの製品が・何個足りているか不足しているか」を継続的に把握するシステムです。
          </P>
          <div className="space-y-2 mt-1">
            <Step n={1}><strong>EDIアップロード</strong> → クライアントから届くEDIファイルを取り込み、受注データとしてデータベース（Appwrite）に保存</Step>
            <Step n={2}><strong>製造計画入力</strong> → 週ごとの製造予定数を画面から入力。原材料在庫でまかなえる分だけが有効な計画として認識されます</Step>
            <Step n={3}><strong>在庫計算</strong> → 初期在庫＋製造計画から、受注を日付順に差し引いて「どの注文でいつ在庫切れになるか」を算出</Step>
            <Step n={4}><strong>可視化・出力</strong> → ダッシュボードやカラーマップで状況を把握し、ExcelやPNGで報告資料を作成</Step>
          </div>
          <Behind>
            すべてのデータはAppwriteのデータベースに格納されています。画面を開くたびに最新データを取得して
            計算を行うため、どのページを見ても数値は一貫しています。
            計算はブラウザ側で行われ（静的エクスポート方式）、サーバーのコールドスタートによる遅延はありません。
          </Behind>
        </GuideSection>

        {/* ══ 1. 在庫計算の基本ロジック ══════════════════════════════════════ */}
        <GuideSection icon="📐" title="在庫計算の基本ロジック（全ページ共通）">
          <P>すべての在庫表示は以下の考え方で計算されています。</P>
          <Formula lines={[
            { text: '開始在庫（初期在庫 ＋ 確定製造計画合計）' },
            { text: '－ 注文①の数量  → 残在庫①', color: 'text-red-600' },
            { text: '－ 注文②の数量  → 残在庫②', color: 'text-red-600' },
            { text: '－ 注文③の数量  → 残在庫③  ←ここでマイナスになったら不足', color: 'text-red-700 font-bold' },
          ]} />
          <P>
            注文は<strong>納期の早い順</strong>に並べて順次差し引きます。
            残在庫がマイナスになった時点が「在庫枯渇点」で、
            その注文以降は追加の製造（＝原材料の手配）が必要になります。
          </P>
          <div className="space-y-1.5">
            <p className="font-semibold text-gray-700">製造計画が在庫に加わる条件：</p>
            <div className="space-y-1">
              <div className="flex gap-2 items-start">
                <span className="text-green-600 font-bold">✅</span>
                <span>その週の製造に必要な原材料が確保されている → 計画数を在庫に加算</span>
              </div>
              <div className="flex gap-2 items-start">
                <span className="text-red-500 font-bold">❌</span>
                <span>原材料が不足している → 作れる分だけを加算、残りは未確定（括弧表示）</span>
              </div>
            </div>
          </div>
          <Note>
            製造計画を加えるタイミングは「その週の金曜日（週末）」です。
            週の途中で製造が完了しても、在庫計算上は金曜日に加算されます。
            これにより週の中の出荷需要と製造出力が混在せず、安全に在庫を確認できます。
          </Note>
          <Behind>
            すべてのページは計算に必要なデータ（orders, product_master, production_plan, material_orders）を
            ページ読み込み時またはボタン押下時に Appwrite DB から直接フェッチします。
            ブラウザ側のキャッシュ（旧 dailyStock コンテキスト）には依存しないため、
            DB に保存された内容が即座に計算に反映されます。
            「更新」ボタンを押すと最新データを再取得して計算をやり直します。
          </Behind>
        </GuideSection>

        {/* ══ 2. ダッシュボード ══════════════════════════════════════════════ */}
        <GuideSection icon="📈" title="ダッシュボード" badge="/dashboard">
          <P>
            全製品の在庫カバレッジを「手配LOT」単位で一覧表示するページです。
            クライアントの手配LOT（1番・2番・…・国①など）ごとに、各製品が充足しているかを色で示します。
            製造計画を追加すると次のLOT以降の色がリアルタイムで更新されます。
          </P>

          <div className="space-y-1">
            <p className="font-semibold text-gray-700 text-xs">色の意味（LOT開始時点の在庫 vs 出荷需要の比率）：</p>
            <div className="grid grid-cols-2 gap-1 text-[11px]">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-100 border border-green-300 flex-shrink-0"/>充足（100%以上）</div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300 flex-shrink-0"/>不足20%未満</div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300 flex-shrink-0"/>不足50%未満</div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 border border-red-300 flex-shrink-0"/>大幅不足 / 在庫なし</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-semibold text-gray-700 text-xs">在庫計算の流れ（LOT間で繰り越す累積差引法）：</p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-[11px] space-y-0.5">
              <p className="text-gray-700">LOT①開始在庫 = 初期在庫 + LOT①開始前に到着する製造出力</p>
              <p className="text-red-600">LOT①終了後   = LOT①開始在庫 − LOT①出荷需要</p>
              <p className="text-green-700">              + LOT①期間中に到着する製造出力</p>
              <p className="text-gray-400 pt-0.5">LOT②開始在庫 = LOT①終了後在庫（そのまま繰り越し）</p>
              <p className="text-red-600">LOT②終了後   = LOT②開始在庫 − LOT②出荷需要 + LOT②期間中製造</p>
              <p className="text-gray-400">… LOT③④と同様に続く</p>
            </div>
          </div>

          <Behind>
            製造出力の「到着日」は製造計画の週月曜日＋4日（金曜日）として計算します。
            例：4/27（月）開始の週の製造は5/1（金）到着として扱います。
            この到着日がLOT開始日より前なら「LOT開始前加算」、
            LOT開始日〜次LOT開始日の間なら「LOT期間中加算」として扱います。
            計算はDBの production_plan を直接読むため、製造スケジュールページで
            計画を保存・更新すると「更新」ボタンを押した次のフェッチで即座に反映されます。
            材料充足チェックはこの計算には含まれていません（材料を考慮した詳細は製造番号別ページ参照）。
          </Behind>

          <Tip>
            この表はクライアントの手配LOT基準です。自社製造番号（G3E2VW等）基準のより詳細な在庫分析は
            製造番号別ページをご覧ください。両ページでロジックが若干異なるため数値の見え方が異なる場合があります。
          </Tip>
        </GuideSection>

        {/* ══ 3. 製造番号別ページ ══════════════════════════════════════════ */}
        <GuideSection icon="📊" title="製造番号別 在庫カスケード" badge="/dashboard/mfg-lot">
          <P>
            自社の製造番号（mfg_lot: G3E2VW, G3E2XW など）ごとに、各製品の在庫がどこまで持つかを
            可視化するページです。製造番号単位での不足量・必要材料量まで確認できます。
          </P>

          <div className="space-y-1.5">
            <p className="font-semibold text-gray-700 text-xs">開始在庫の計算（毎回DBから直接取得）：</p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-[11px] space-y-0.5">
              <p className="text-gray-700">開始在庫 = 初期在庫 + 確定製造計画合計（材料チェック済み）</p>
              <p className="text-gray-400 text-[10px] pt-1">材料チェックの判定：</p>
              <p className="text-green-700">  週ごとに sort_order 順で材料を割り当て → 足りる分だけ確定</p>
              <p className="text-red-600">  材料プールを超える計画 → その週の当該製品はゼロ（未確定）</p>
              <p className="text-gray-700 pt-0.5">確定分の合計を初期在庫に加算 → 開始在庫確定</p>
            </div>
          </div>

          <Behind>
            ページを開く（または更新ボタンを押す）たびに Appwrite DB から
            orders, product_master, production_plan, material_orders の4テーブルを直接フェッチします。
            クライアント側のキャッシュ（dailyStock コンテキスト）には依存しないため、
            製造スケジュールページで計画を保存した直後に「更新」ボタンを押せば即座に反映されます。
            材料プールは confirmed/delivery_confirmed/initial_stock ステータスの合計で計算します。
            そこから製造番号の納期順に注文を差し引いて、どの製造番号で在庫が尽きるかを判定します。
          </Behind>

          <div className="space-y-1.5">
            <p className="font-semibold text-gray-700 text-xs">ダッシュボードとの計算方法の違い：</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600 border border-gray-200">項目</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600 border border-gray-200">ダッシュボード</th>
                    <th className="px-2 py-1.5 text-left font-medium text-gray-600 border border-gray-200">製造番号別</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['列の単位', 'クライアント手配LOT（1,2,3…）', '自社製造番号（G3E2VW…）'],
                    ['DBフェッチ', 'orders / product_master / lot_definitions / production_plan', 'orders / product_master / production_plan / material_orders'],
                    ['製造の加算方法', 'LOT間に金曜到着として配分（累積差引）', '全確定製造を開始在庫に一括加算して滝式差引'],
                    ['材料チェック', '含まない（全計画を加算）', '含む（グリーディ週次割り当て）'],
                    ['更新タイミング', '更新ボタンで即反映', '更新ボタンで即反映'],
                    ['キャッシュ依存', 'なし（DB直接）', 'なし（DB直接）'],
                  ].map(([item, dash, mfg]) => (
                    <tr key={item} className="border border-gray-200">
                      <td className="px-2 py-1.5 font-medium text-gray-700 bg-gray-50 border-r border-gray-200">{item}</td>
                      <td className="px-2 py-1.5 text-gray-600 border-r border-gray-200">{dash}</td>
                      <td className="px-2 py-1.5 text-gray-600">{mfg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-gray-700 text-xs">2種類の表示モード：</p>
            <div className="border border-gray-200 rounded-lg p-2.5 space-y-1">
              <p className="font-semibold text-xs text-gray-700">🎨 カラーマップ</p>
              <P>製造番号×製品のマトリクスを色で表示。各セルの数字はその製造番号での出荷需要数。
              セルをクリックすると詳細カスケード（在庫残高・不足量・kgを表示）に切り替わります。</P>
            </div>
            <div className="border border-gray-200 rounded-lg p-2.5 space-y-1">
              <p className="font-semibold text-xs text-gray-700">📊 詳細カスケード</p>
              <P>全製品のSVGウォーターフォールチャート。各製造番号で在庫がどれだけ残るか（緑バー）、
              または何個不足するか（赤バー）をバーで表示。赤い点線が在庫枯渇点。</P>
            </div>
          </div>

          <div className="space-y-1">
            <p className="font-semibold text-gray-700 text-xs">PNG出力ボタン：</p>
            <div className="space-y-1 text-xs text-gray-600">
              <div className="flex gap-2"><span className="font-mono bg-gray-100 px-1 rounded">📥 カスケードPNG</span><span>詳細カスケードSVGをPNG出力</span></div>
              <div className="flex gap-2"><span className="font-mono bg-gray-100 px-1 rounded">📥 マップPNG</span><span>現在のカラーマップ（クリックで開いたセルを含む混在状態）をPNG出力</span></div>
            </div>
          </div>

          <P>
            ページ下部の「追加生産・材料発注の推奨」テーブルでは、不足している製造番号ごとに
            どの製品が何個不足し、解消に何kgの原材料が必要かを一覧で確認できます。
          </P>
        </GuideSection>

        {/* ══ 4. 製造スケジュール ══════════════════════════════════════════ */}
        <GuideSection icon="🏭" title="製造スケジュール" badge="/dashboard/manufacturing/production">
          <P>
            週ごとの製造予定数を入力・管理するページです。
            ここで入力した数値が在庫計算の「製造出力」として使われます。
          </P>
          <div className="space-y-2">
            <Step n={1}>製品・週を選んで製造予定数を入力します</Step>
            <Step n={2}>アプリはその週の製造に必要な原材料量を自動計算します（製品重量×製造数÷1000 = kg）</Step>
            <Step n={3}>原材料が足りる場合は数値がそのまま確定製造として計上され、在庫計算に反映されます</Step>
            <Step n={4}>足りない場合はセルが赤くなり、括弧付き（未確定）として表示。在庫計算には含まれません</Step>
          </div>
          <Behind>
            同じ原材料グループ（M90S, 300NP, 100G20, 950X01）を使う製品は材料を共有します。
            週の中で優先順位の高い製品から順に材料を割り当て、材料が尽きた時点でそれ以降の製品の
            製造計画はゼロ扱いになります（貪欲法）。材料確定・未確定の判定はこのロジックで行われます。
          </Behind>
          <Note>
            製造計画を変更したあとは、そのページの「更新」ボタンを押すと
            最新の計算結果が即座に反映されます。ダッシュボードや製造番号別ページも
            それぞれの更新ボタンを押すと最新状態になります。
          </Note>
        </GuideSection>

        {/* ══ 5. 原材料入荷スケジュール ══════════════════════════════════════ */}
        <GuideSection icon="🚢" title="原材料入荷スケジュール" badge="/dashboard/material">
          <P>
            原材料（M90S, 300NP, 100G20, 950X01）の入荷注文・在庫フローを管理するページです。
            入荷ステータスの管理と、週ごとの在庫推移の確認ができます。
          </P>
          <div className="space-y-1">
            <p className="font-semibold text-gray-700">ステータスの種類と意味：</p>
            <div className="space-y-0.5 text-xs">
              <div className="flex gap-2"><span className="font-semibold text-gray-500">保留中</span><span>発注を検討中。在庫計算に含まれない</span></div>
              <div className="flex gap-2"><span className="font-semibold text-amber-600">発注済・確認待</span><span>発注済みだが商社からの確認がまだ。在庫計算に含まれない</span></div>
              <div className="flex gap-2"><span className="font-semibold text-blue-600">確認済</span><span>商社が受注確認。在庫計算に加算される</span></div>
              <div className="flex gap-2"><span className="font-semibold text-green-600">納入確定</span><span>入荷日が確定。在庫計算に加算される</span></div>
            </div>
          </div>
          <Behind>
            「確認済」「納入確定」のみが原材料在庫として計算に含まれます。
            週次フローチャートでは各週の入荷量（＋）と製造消費量（－）を積み上げて
            週末残在庫を表示します。製造消費量は製造計画の確定分から計算します。
            入荷予定日がその週に入る確認済入荷が「入荷＋」として表示されます。
          </Behind>
          <P>
            FAX出力ボタン（📠）から、各商社宛ての発注確認書（Word形式）を
            その商社の発注一覧から自動生成して出力できます。
          </P>
        </GuideSection>

        {/* ══ 6. 材料配分シミュレーター ══════════════════════════════════════ */}
        <GuideSection icon="🧮" title="材料配分シミュレーター" badge="/dashboard/mfg-lot/allocation">
          <P>
            製造番号ごとに「在庫がどこまで持つか」と「追加でどれだけ材料を発注すべきか」を
            数値で確認するページです。現在検証中のため参考値としてご利用ください。
          </P>

          <div className="space-y-1.5">
            <p className="font-semibold text-gray-700 text-xs">サマリーカードの見方（グループごと）：</p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 font-mono text-[11px] space-y-0.5">
              <p className="text-gray-700">計画後残余  = 初期在庫 + 52週間の確定入荷合計 − 52週間の製造消費合計</p>
              <p className="text-gray-400 text-[10px]">  ※ 正の値 = 計画終了後に余る材料 / 負の値 = 計画中に材料不足</p>
              <p className="text-gray-700 pt-0.5">LOT不足合計 = 製造番号ごとの製品不足数 × 重量(g) の合計 kg</p>
              <p className="text-red-600 pt-0.5">追加発注必要 = LOT不足合計 − 計画後残余</p>
              <p className="text-gray-400 text-[10px]">  ※ 残余がプラスなら差し引き、マイナスなら加算して純必要量を算出</p>
            </div>
          </div>

          <Behind>
            material_orders, production_plan, orders, product_master の4テーブルをDBから直接フェッチします。
            計画後残余は52週間のフロー計算で算出します（原材料入荷ページのグラフと同じロジック）。
            製品ごとの開始在庫は初期在庫＋確定製造計画（材料チェック済みグリーディ割り当て）で算出します。
            製造番号の納期順に需要を差し引いて、どの製造番号から在庫が不足するかを判定します。
            すべてDBから直接計算するためキャッシュ依存はありません。
          </Behind>

          <Tip>
            追加発注必要がマイナス（充足）でも「計画後残余」がゼロに近い場合は、
            製造計画の追加余地が少ないことを示します。原材料入荷スケジュールで
            追加発注を検討してください。
          </Tip>
        </GuideSection>

        {/* ══ 7. 注文一覧ページ ══════════════════════════════════════════════ */}
        {!isGuest && (
          <GuideSection icon="📦" title="注文一覧" badge="/dashboard/orders">
            <P>
              すべての受注データを一覧で確認し、Excel出力・回答納期チェックを行うページです。
            </P>
            <div className="space-y-2">
              <div className="border border-gray-200 rounded-lg p-2.5 space-y-1">
                <p className="font-semibold text-xs text-gray-700">📥 出力ボタン（Excel）</p>
                <P>グループ・製造番号でフィルタして出力できます。出力内容：</P>
                <div className="space-y-1 ml-2">
                  <div className="flex gap-1.5"><span className="text-gray-400">①</span><span><strong>在庫枯渇サマリー</strong> — 在庫切れになる最初の注文・日付・製造番号を製品ごとに一覧</span></div>
                  <div className="flex gap-1.5"><span className="text-gray-400">②</span><span><strong>初期在庫計算</strong> — 製品ごとの初期在庫と週次製造計画（確定分のみ）の明細</span></div>
                  <div className="flex gap-1.5"><span className="text-gray-400">③</span><span><strong>材料入荷予定</strong> — 原材料の発注リスト・現時点残在庫・製造消費済kg</span></div>
                  <div className="flex gap-1.5"><span className="text-gray-400">④</span><span><strong>製品別シート</strong> — 納期順注文リストと在庫残高（J列:個数, K列:kg）の累積差引表</span></div>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg p-2.5 space-y-1">
                <p className="font-semibold text-xs text-gray-700">📋 回答納期チェック</p>
                <P>クライアントから届く「アンマッチ」Excelファイルをアップロードすると、
                各注文番号に対してOK/NGを自動で判定して<strong>O列（機械チェック結果）</strong>に書き込み、ダウンロードします。
                K列（回答納期）は空欄のまま残るので、O列の結果を参考にしながら担当者が手動で回答内容を入力してください。</P>
                <Behind>
                  Excelの注文番号（例：JK5042528）に001〜005のサフィックスを試して
                  Appwrite DBの注文（JK5042528001）と照合します。
                  照合できた注文について、その注文が差し引かれた時点で在庫残高が0以上なら「OK」、
                  マイナスなら「NG」とO列に書き込みます。
                  K列は担当者が手動で確認・記入する回答欄として残します。
                </Behind>
              </div>
            </div>
          </GuideSection>
        )}

        {/* ══ 8. EDIアップロード・マスタ管理 ══════════════════════════════ */}
        {isAdmin && (
          <GuideSection icon="📡" title="EDIアップロード・マスタ管理" badge="管理者のみ">
            <P>
              受注データの取り込みと、製品マスタ情報の管理を行うページです。
            </P>
            <div className="space-y-2">
              <div>
                <p className="font-semibold text-xs text-gray-700 mb-1">EDIアップロード</p>
                <P>クライアントから届くEDIファイル（CSV/Excel形式）をアップロードします。
                ファイルを読み込むと注文番号・製品コード・数量・納期などが自動的にAppwrite DBに登録されます。</P>
              </div>
              <div>
                <p className="font-semibold text-xs text-gray-700 mb-1">製品マスタ管理</p>
                <P>製品コード・グループ名・重量(g)・初期在庫・並び順などの基本情報を管理します。
                重量(g)は原材料消費量の計算に使われるため、正確な値の登録が重要です。</P>
              </div>
              <Behind>
                EDIアップロード時にはファイルのパースと重複チェックが行われます。
                既存の注文番号がある場合は更新（upsert）処理が行われ、新規分のみ追加されます。
                製品マスタの重量が未設定の場合、その製品の原材料消費量が計算できないため
                製造スケジュールページで警告が表示されます。
              </Behind>
            </div>
          </GuideSection>
        )}

        {/* ══ 9. ロール別機能一覧 ══════════════════════════════════════════ */}
        <GuideSection icon="🔑" title="ロール別 利用できる機能">
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1.5 bg-gray-100 rounded-tl font-semibold text-gray-600">機能</th>
                  <th className="px-2 py-1.5 bg-gray-100 text-center font-semibold text-gray-500">👁 ゲスト</th>
                  <th className="px-2 py-1.5 bg-emerald-50 text-center font-semibold text-emerald-700">🏭 製造担当</th>
                  <th className="px-2 py-1.5 bg-blue-50 text-center font-semibold text-blue-700 rounded-tr">🔑 管理者</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['ダッシュボード閲覧', '✅', '✅', '✅'],
                  ['製造番号別カスケード閲覧', '✅', '✅', '✅'],
                  ['カラーマップ・PNG出力', '✅', '✅', '✅'],
                  ['原材料入荷スケジュール閲覧', '✅', '✅', '✅'],
                  ['製造スケジュール閲覧', '❌', '✅', '✅'],
                  ['製造計画の入力・変更', '❌', '✅', '✅'],
                  ['注文一覧・Excel出力', '❌', '✅', '✅'],
                  ['回答納期チェック', '❌', '✅', '✅'],
                  ['原材料入荷ステータス変更', '❌', '❌', '✅'],
                  ['FAX出力（Word）', '❌', '❌', '✅'],
                  ['EDIアップロード', '❌', '❌', '✅'],
                  ['製品マスタ管理', '❌', '❌', '✅'],
                ].map(([feat, guest, editor, admin], i) => (
                  <tr key={feat} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                    <td className="px-2 py-1.5 text-gray-600 border-b border-gray-100">{feat}</td>
                    <td className="px-2 py-1.5 text-center border-b border-gray-100">{guest}</td>
                    <td className="px-2 py-1.5 text-center border-b border-gray-100">{editor}</td>
                    <td className="px-2 py-1.5 text-center border-b border-gray-100">{admin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>
            ゲストと製造担当者はシミュレーションモードで原材料ページにアクセスできます。
            変更はそのブラウザセッション内のみに反映され、データベースには保存されません。
          </Note>
        </GuideSection>

        {/* ══ 10. 在庫再計算ボタン ══════════════════════════════════════════ */}
        <GuideSection icon="🔁" title="在庫を再計算 / 更新 ボタン">
          <P>
            各ページの「更新」ボタンを押すと、Appwrite DBから最新データを再取得して
            在庫計算をやり直します。
          </P>
          <P>以下の操作後は更新ボタンを押して最新状態を確認することを推奨します：</P>
          <div className="space-y-0.5 ml-2 text-xs text-gray-600">
            <p>• 製造スケジュールページで計画を追加・変更したとき</p>
            <p>• 原材料の入荷ステータスを変更したとき</p>
            <p>• EDIアップロード後に最新の状況を確認したいとき</p>
          </div>
          <Behind>
            すべてのページは在庫計算をクライアントキャッシュに依存せず、
            更新ボタンを押すたびにDBから直接フェッチして計算します。
            左パネルの「在庫を再計算」ボタンは旧バックグラウンド計算エンジン向けのもので、
            現在は各ページの「更新」ボタンで同等の効果が得られます。
          </Behind>
          <Tip>
            製造計画を変更したらそのページのまま「更新」ボタンを押すと即座に色が変わります。
          </Tip>
        </GuideSection>

      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-100 text-center">
        <p className="text-[10px] text-gray-300">EDI Manager — 使い方ガイド</p>
      </div>

    </div>
  )
}