import detectPatterns from '../../tools/detect_patterns.js';
import { DetectPatternsInputSchema, DetectPatternsOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';
import { timeframeLabel } from '../../lib/formatter.js';
import { toIsoTime } from '../../lib/datetime.js';

export const toolDef: ToolDefinition = {
	name: 'detect_patterns',
	description: '古典的チャートパターン（ダブルトップ/ヘッドアンドショルダーズ/三角持ち合い/ウェッジ等）を統合検出します。\n\n🆕 統合版: 形成中（forming）と完成済み（completed）の両方を1回で取得可能。\n\n【オプション】\n- includeForming: true → 形成中パターンを含める（status=forming/near_completion）\n- includeCompleted: true → 完成済みパターンを含める（status=completed）\n- requireCurrentInPattern + currentRelevanceDays: 鮮度フィルタ（N日以内のみ）\n\n【パターン別推奨パラメータ】\n- pennant/flag: swingDepth≈5, minBarsBetweenSwings≈3（短期の旗型パターン向け）\n- triangle/wedge: swingDepth≈10, tolerancePct≈0.03（中期の収束パターン向け）\n- double_top/double_bottom: tolerancePct≈0.02（価格水準の一致精度重視）\n\n【出力】\n- content: 検出名・パターン整合度・期間・ステータス\n- 全パターン: status（forming/near_completion/completed）、breakoutDirection（up/down）、outcome（success/failure）を含む\n- 視覚確認: structuredContent.data.overlays を render_chart_svg.overlays に渡す\n\nview=summary|detailed|full（既定=detailed）。',
	inputSchema: DetectPatternsInputSchema,
	handler: async ({ pair, type, limit, patterns, swingDepth, tolerancePct, minBarsBetweenSwings, view, requireCurrentInPattern, currentRelevanceDays }: any) => {
		const out = await detectPatterns(pair, type, limit, { patterns, swingDepth, tolerancePct, minBarsBetweenSwings, requireCurrentInPattern, currentRelevanceDays });
		const res = DetectPatternsOutputSchema.parse(out as any);
		if (!res?.ok) return res as any;
		const pats: any[] = Array.isArray((res as any)?.data?.patterns) ? (res as any).data.patterns : [];
		const meta: any = (res as any)?.meta || {};
		const count = Number(meta?.count ?? pats.length ?? 0);
		const tfLabel = timeframeLabel(String(type));
		const hdr = `${String(pair).toUpperCase()} ${tfLabel}（${String(type)}） ${limit ?? count}本から${pats.length}件を検出`;
		// Debug view: list swings and candidates with reasons
		if (view === 'debug') {
			const swings = Array.isArray(meta?.debug?.swings) ? meta.debug.swings : [];
			const cands = Array.isArray(meta?.debug?.candidates) ? meta.debug.candidates : [];
			const swingLines = swings.map((s: any) => `- ${s.kind} idx=${s.idx} price=${Math.round(Number(s.price)).toLocaleString()} (${s.isoTime || 'n/a'})`);
			const candLines = cands.map((c: any, i: number) => {
				const tag = c.accepted ? '✅' : '❌';
				const reason = c.accepted ? (c.reason ? ` (${c.reason})` : '') : (c.reason ? ` [${c.reason}]` : '');
				const pts = Array.isArray(c.points) ? c.points.map((p: any) => `${p.role}@${p.idx}:${Math.round(Number(p.price)).toLocaleString()}`).join(', ') : '';
				const indices = Array.isArray(c.indices) ? ` indices=[${c.indices.join(',')}]` : '';
				// details を必ず表示（spread と slopes）
				let detailsStr = '\n   details: none';
				if (c.details) {
					const d = c.details || {};
					const s1 = Number(d.spreadStart);
					const s2 = Number(d.spreadEnd);
					const hi = Number(d.hiSlope);
					const lo = Number(d.loSlope);
					const spreadPart = (Number.isFinite(s1) && Number.isFinite(s2))
						? `${Math.round(s1).toLocaleString()} → ${Math.round(s2).toLocaleString()}`
						: 'n/a';
					const hiPart = Number.isFinite(hi) ? hi.toFixed(8) : 'n/a';
					const loPart = Number.isFinite(lo) ? lo.toFixed(8) : 'n/a';
					// 専用: type_classification_failed の内訳を本文に表示
					if (String(c?.reason) === 'type_classification_failed') {
						const fh = Number(d?.slopeHigh);
						const fl = Number(d?.slopeLow);
						const fr = String(d?.failureReason || '');
						const ratio = Number(d?.slopeRatio);
						const fhStr = Number.isFinite(fh) ? fh.toFixed(8) : 'n/a';
						const flStr = Number.isFinite(fl) ? fl.toFixed(8) : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? ratio.toFixed(3) : 'n/a';
						detailsStr =
							`\n   failureReason: ${fr || 'n/a'}` +
							`\n   slopes: hi=${fhStr} lo=${flStr}` +
							`\n   slopeRatio: ${ratioStr}`;
					} else if (String(c?.reason) === 'probe_window') {
						const fh = Number(d?.slopeHigh);
						const fl = Number(d?.slopeLow);
						const pr = Number(d?.priceRange);
						const bs = Number(d?.barsSpan);
						const ms = Number(d?.minMeaningfulSlope);
						const fhStr = Number.isFinite(fh) ? fh.toFixed(8) : 'n/a';
						const flStr = Number.isFinite(fl) ? fl.toFixed(8) : 'n/a';
						const prStr = Number.isFinite(pr) ? Math.round(pr).toLocaleString() : 'n/a';
						const bsStr = Number.isFinite(bs) ? String(bs) : 'n/a';
						const msStr = Number.isFinite(ms) ? ms.toFixed(8) : 'n/a';
						const highsIn = Array.isArray(d?.highsIn) ? d.highsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						const lowsIn = Array.isArray(d?.lowsIn) ? d.lowsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						detailsStr =
							`\n   upper.slope: ${fhStr}` +
							`\n   lower.slope: ${flStr}` +
							`\n   priceRange: ${prStr}` +
							`\n   barsSpan: ${bsStr}` +
							`\n   minMeaningfulSlope: ${msStr}` +
							`\n   highsIn: ${highsIn}` +
							`\n   lowsIn: ${lowsIn}`;
					} else if (String(c?.reason) === 'declining_highs' || String(c?.reason) === 'declining_highs_probe') {
						const fa = Number(d?.firstAvg);
						const sa = Number(d?.secondAvg);
						const ratio = Number(d?.ratio);
						const faStr = Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a';
						const saStr = Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? (ratio * 100).toFixed(1) + '%' : 'n/a';
						const cnt = Number(d?.highsCount);
						const cntStr = Number.isFinite(cnt) ? String(cnt) : 'n/a';
						detailsStr =
							`\n   ${String(c?.reason) === 'declining_highs' ? 'declining_highs: true' : 'declining_highs_probe: metrics'}` +
							`\n   highsIn.count: ${cntStr}` +
							`\n   1st half avg: ${faStr}` +
							`\n   2nd half avg: ${saStr}` +
							`\n   ratio: ${ratioStr}`;
					} else if (String(c?.reason) === 'rising_probe') {
						const r2h = Number(d?.r2High), r2l = Number(d?.r2Low);
						const sh = Number(d?.slopeHigh), sl = Number(d?.slopeLow);
						const sratio = Number(d?.slopeRatioLH);
						const pr = Number(d?.priceRange), bs = Number(d?.barsSpan), ms = Number(d?.minMeaningfulSlope);
						const fa = Number(d?.firstAvg), sa = Number(d?.secondAvg), dr = Number(d?.ratio);
						const highsIn = Array.isArray(d?.highsIn) ? d.highsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						const lowsIn = Array.isArray(d?.lowsIn) ? d.lowsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						detailsStr =
							`\n   r2: hi=${Number.isFinite(r2h) ? r2h.toFixed(3) : 'n/a'}, lo=${Number.isFinite(r2l) ? r2l.toFixed(3) : 'n/a'}` +
							`\n   slopes: hi=${Number.isFinite(sh) ? sh.toFixed(6) : 'n/a'} lo=${Number.isFinite(sl) ? sl.toFixed(6) : 'n/a'}` +
							`\n   slopeRatioLH: ${Number.isFinite(sratio) ? sratio.toFixed(3) : 'n/a'}` +
							`\n   priceRange: ${Number.isFinite(pr) ? Math.round(pr).toLocaleString() : 'n/a'}, barsSpan: ${Number.isFinite(bs) ? String(bs) : 'n/a'}` +
							`\n   minMeaningfulSlope: ${Number.isFinite(ms) ? ms.toFixed(6) : 'n/a'}` +
							`\n   highsIn: ${highsIn}` +
							`\n   lowsIn: ${lowsIn}` +
							`\n   declining_highs metrics: firstAvg=${Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a'}, secondAvg=${Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a'}, ratio=${Number.isFinite(dr) ? (dr * 100).toFixed(1) + '%' : 'n/a'}`;
					} else if (String(c?.reason) === 'post_filter_rising_highs_not_declining') {
						const fa = Number(d?.firstAvg);
						const sa = Number(d?.secondAvg);
						const ratio = Number(d?.ratio);
						const faStr = Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a';
						const saStr = Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? (ratio * 100).toFixed(1) + '%' : 'n/a';
						const cnt = Number(d?.highsCount);
						const cntStr = Number.isFinite(cnt) ? String(cnt) : 'n/a';
						detailsStr =
							`\n   post_filter: rising highs not declining` +
							`\n   highsIn.count: ${cntStr}` +
							`\n   1st half avg: ${faStr}` +
							`\n   2nd half avg: ${saStr}` +
							`\n   ratio: ${ratioStr}`;
					} else if (String(c?.reason) === 'post_filter_falling_lows_not_rising') {
						const fa = Number(d?.firstAvg);
						const sa = Number(d?.secondAvg);
						const ratio = Number(d?.ratio);
						const faStr = Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a';
						const saStr = Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? (ratio * 100).toFixed(1) + '%' : 'n/a';
						const cnt = Number(d?.lowsCount);
						const cntStr = Number.isFinite(cnt) ? String(cnt) : 'n/a';
						detailsStr =
							`\n   post_filter: falling lows not rising` +
							`\n   lowsIn.count: ${cntStr}` +
							`\n   1st half avg: ${faStr}` +
							`\n   2nd half avg: ${saStr}` +
							`\n   ratio: ${ratioStr}`;
					} else {
						detailsStr = `\n   spread: ${spreadPart}${(Number.isFinite(hi) || Number.isFinite(lo)) ? `, slopes: hi=${hiPart} lo=${loPart}` : ''}`;
					}
				}
				return `${i + 1}. ${tag} ${c.type}${reason}${indices}${pts ? `\n   ${pts}` : ''}${detailsStr}`;
			});
			const text = [
				hdr,
				'',
				'【Swings】',
				swingLines.length ? swingLines.join('\n') : 'なし',
				'',
				'【Candidates】',
				candLines.length ? candLines.join('\n') : 'なし',
			].join('\n');
			// structuredContent に candidates を含める
			try {
				const result: any = res as any;
				return {
					content: [{ type: 'text', text }],
					structuredContent: {
						data: {
							patterns: (result?.data?.patterns ?? []),
							overlays: (result?.data?.overlays ?? null),
							candidates: cands,
						},
						meta: result?.meta ?? {},
						ok: result?.ok ?? true,
						summary: result?.summary ?? hdr,
					} as Record<string, unknown>,
				};
			} catch {
				return { content: [{ type: 'text', text }], structuredContent: res as any };
			}
		}
		// detection period (if candles range available in meta or infer from patterns)
		let periodLine = '';
		try {
			const toTs = (s?: string) => { try { return s ? Date.parse(s) : NaN; } catch { return NaN; } };
			const ends = pats.map(p => toTs(p?.range?.end)).filter((x: number) => Number.isFinite(x));
			const starts = pats.map(p => toTs(p?.range?.start)).filter((x: number) => Number.isFinite(x));
			if (starts.length && ends.length) {
				const startIso = (toIsoTime(Math.min(...starts)) ?? '').slice(0, 10);
				const endIso = (toIsoTime(Math.max(...ends)) ?? '').slice(0, 10);
				const days = Math.max(1, Math.round((Math.max(...ends) - Math.min(...starts)) / 86400000));
				periodLine = `検出対象期間: ${startIso} ~ ${endIso}（${days}日間）`;
			}
		} catch { }
		// 種別別件数集計
		const byType = pats.reduce((m: Record<string, number>, p: any) => { const k = String(p?.type || 'unknown'); m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>);
		const typeSummary = Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(', ');
		const fmtLine = (p: any, idx: number) => {
			const name = String(p?.type || 'unknown');
			const conf = p?.confidence != null ? Number(p.confidence).toFixed(2) : 'n/a';
			const range = p?.range ? `${p.range.start} ~ ${p.range.end}` : 'n/a';
			let priceRange: string | null = null;
			if (Array.isArray(p?.pivots) && p.pivots.length) {
				const prices = p.pivots.map((v: any) => Number(v?.price)).filter((x: any) => Number.isFinite(x));
				if (prices.length) priceRange = `${Math.min(...prices).toLocaleString()}円 - ${Math.max(...prices).toLocaleString()}円`;
			}
			let neckline: string | null = null;
			if (Array.isArray(p?.neckline) && p.neckline.length === 2) {
				const [a, b] = p.neckline;
				const y1 = Number(a?.y);
				const y2 = Number(b?.y);
				if (Number.isFinite(y1) && Number.isFinite(y2)) {
					neckline = (y1 === y2)
						? `${y1.toLocaleString()}円（水平）`
						: `${y1.toLocaleString()}円 → ${y2.toLocaleString()}円`;
				}
			}
			// map idx -> isoTime using debug swings if available
			const idxToIso: Record<number, string> = {};
			try {
				const swings = (meta as any)?.debug?.swings;
				if (Array.isArray(swings)) {
					for (const s of swings) {
						const i = Number((s as any)?.idx);
						const t = String((s as any)?.isoTime || '');
						if (Number.isFinite(i) && t) idxToIso[i] = t;
					}
				}
			} catch { /* noop */ }
			// pivot detail lines (only for full/debug and double_top/double_bottom)
			const pivotLines: Array<string | null> = [];
			if ((view === 'full' || view === 'debug') && Array.isArray(p?.pivots) && p.pivots.length >= 3) {
				const pivs = p.pivots as Array<{ idx: number; price: number }>;
				const roleLabels =
					p.type === 'double_top'
						? ['山1', '谷', '山2']
						: (p.type === 'double_bottom' ? ['谷1', '山', '谷2'] : null);
				if (roleLabels) {
					for (let i = 0; i < 3; i++) {
						const pv = pivs[i];
						if (!pv) continue;
						const d = idxToIso[Number(pv.idx)] || '';
						const date = d ? d.slice(0, 10) : 'n/a';
						pivotLines.push(`   - ${roleLabels[i]}: ${date} (${Math.round(Number(pv.price)).toLocaleString()}円)`);
					}
				}
			}
			// breakout detail if present
			let breakoutLine: string | null = null;
			try {
				if ((view === 'full' || view === 'debug') && p?.breakout?.idx != null) {
					const bidx = Number(p.breakout.idx);
					const bpx = Number(p.breakout.price);
					const bdate = idxToIso[bidx] ? String(idxToIso[bidx]).slice(0, 10) : 'n/a';
					const bprice = Number.isFinite(bpx) ? Math.round(bpx).toLocaleString() : 'n/a';
					breakoutLine = `   - ブレイク: ${bdate} (${bprice}円)`;
				}
			} catch { /* ignore */ }
			// status（全パターン共通）
			let statusLine: string | null = null;
			if (p?.status) {
				const statusJa: Record<string, string> = {
					completed: '完成（ブレイクアウト確認済み）',
					invalid: '無効（期待と逆方向にブレイク）',
					forming: '形成中',
					near_completion: 'ほぼ完成（apex接近）',
				};
				statusLine = `   - 状態: ${statusJa[p.status] || p.status}`;
			}
			// ブレイク方向と結果（全パターン共通）
			let outcomeLine: string | null = null;
			try {
				if (p?.breakoutDirection && p?.outcome) {
					const directionJa = p.breakoutDirection === 'up' ? '上方' : '下方';
					const outcomeJa = p.outcome === 'success' ? '成功' : '失敗';
					const expectedDirMap: Record<string, string | undefined> = {
						falling_wedge: '上方', rising_wedge: '下方',
						triangle_ascending: '上方', triangle_descending: '下方',
						pennant: p.poleDirection === 'up' ? '上方' : p.poleDirection === 'down' ? '下方' : undefined,
					};
					const expectedDir = expectedDirMap[p.type];
					const meaningMap: Record<string, Record<string, string>> = {
						falling_wedge: { success: '強気転換', failure: '弱気継続' },
						rising_wedge: { success: '弱気転換', failure: '強気継続' },
						triangle_ascending: { success: '上方ブレイク（強気）', failure: '下方ブレイク（弱気転換）' },
						triangle_descending: { success: '下方ブレイク（弱気）', failure: '上方ブレイク（強気転換）' },
						pennant: {
							success: `トレンド継続（${p.poleDirection === 'up' ? '強気' : '弱気'}）`,
							failure: `ダマシ（${p.poleDirection === 'up' ? '弱気転換' : '強気転換'}）`,
						},
					};
					const meaning = meaningMap[p.type]?.[p.outcome] || `${directionJa}ブレイク`;
					let dirLine = `   - ブレイク方向: ${directionJa}ブレイク`;
					if (expectedDir) dirLine += `（本来は${expectedDir}ブレイクが期待されるパターン）`;
					outcomeLine = `${dirLine}\n   - パターン結果: ${outcomeJa}（${meaning}）`;
				}
			} catch { /* ignore */ }
			// ペナント固有フィールド
			let pennantLine: string | null = null;
			try {
				if (p?.type === 'pennant') {
					const parts: string[] = [];
					if (p.poleDirection) parts.push(`フラッグポール方向: ${p.poleDirection === 'up' ? '上昇' : '下降'}`);
					if (p.priorTrendDirection) parts.push(`先行トレンド: ${p.priorTrendDirection === 'bullish' ? '強気（上昇トレンド）' : '弱気（下降トレンド）'}`);
					if (p.flagpoleHeight != null) parts.push(`フラッグポール値幅: ${Math.round(Number(p.flagpoleHeight)).toLocaleString()}円`);
					if (p.retracementRatio != null) {
						const pctStr = (Number(p.retracementRatio) * 100).toFixed(0);
						parts.push(`戻し比率: ${pctStr}%${Number(p.retracementRatio) > 0.38 ? '（高め — トライアングル寄り）' : '（正常範囲）'}`);
					}
					if (p.isTrendContinuation !== undefined) parts.push(`トレンド継続: ${p.isTrendContinuation ? 'はい（成功）' : 'いいえ（ダマシ）'}`);
					if (parts.length) pennantLine = parts.map(s => `   - ${s}`).join('\n');
				}
			} catch { /* ignore */ }
			// structure diagram SVG (inline for LLM visibility)
			let diagramBlock: string | null = null;
			try {
				if ((view === 'full' || view === 'detailed') && p?.structureDiagram?.svg) {
					const diagram = p.structureDiagram;
					const id = String(diagram?.artifact?.identifier || 'pattern-diagram');
					const title = String(diagram?.artifact?.title || 'パターン構造図');
					const svg = String(diagram.svg);
					diagramBlock = [
						'--- Structure Diagram (SVG) ---',
						`identifier: ${id}`,
						`title: ${title}`,
						'type: image/svg+xml',
						'',
						svg
					].join('\n');
				}
			} catch { /* noop */ }
			const lines = [
				`${idx + 1}. ${name} (パターン整合度: ${conf})`,
				`   - 期間: ${range}`,
				statusLine,
				priceRange ? `   - 価格範囲: ${priceRange}` : null,
				...(pivotLines.length ? pivotLines : []),
				neckline ? `   - ${p?.trendlineLabel || 'ネックライン'}: ${neckline}` : null,
				breakoutLine,
				outcomeLine,
				// ターゲット価格情報（全パターン共通）
				p?.breakoutTarget != null ? (() => {
					const methodJa: Record<string, string> = { flagpole_projection: 'フラッグポール値幅投影', pattern_height: 'パターン高さ投影', neckline_projection: 'ネックライン投影' };
					let targetLine = `   - ターゲット価格: ${Math.round(Number(p.breakoutTarget)).toLocaleString()}円（${methodJa[p.targetMethod] || p.targetMethod}）`;
					if (p?.targetReachedPct != null) {
						targetLine += `\n   - ターゲット進捗: ${p.targetReachedPct}%${Number(p.targetReachedPct) >= 100 ? '（到達済み）' : ''}`;
					}
					return targetLine;
				})() : null,
				pennantLine,
				diagramBlock,
			].filter(Boolean);
			return lines.join('\n');
		};
		if ((view || 'detailed') === 'summary') {
			const toTs = (s?: string) => { try { return s ? Date.parse(s) : NaN; } catch { return NaN; } };
			const now = Date.now();
			const within = (ms: number) => pats.filter(p => Number.isFinite(toTs(p?.range?.end)) && (now - toTs(p.range.end)) <= ms).length;
			const in30 = within(30 * 86400000);
			const in90 = within(90 * 86400000);
			const text = `${hdr}（${typeSummary || '分類なし'}、直近30日: ${in30}件、直近90日: ${in90}件）\n${periodLine ? periodLine + '\n' : ''}検討パターン: ${(patterns && patterns.length) ? patterns.join(', ') : '既定セット'}\n※形成中は includeForming=true を指定してください。\n詳細は structuredContent.data.patterns を参照。`;
			return { content: [{ type: 'text', text }], structuredContent: res as any };
		}
		if ((view || 'detailed') === 'full') {
			const body = pats.map((p, i) => fmtLine(p, i)).join('\n\n');
			const overlayNote = (res as any)?.data?.overlays ? '\n\nチャート連携: structuredContent.data.overlays を render_chart_svg.overlays に渡すと注釈/範囲を描画できます。' : '';
			const trustNote = '\n\nパターン整合度について（形状一致度・対称性・期間から算出）:\n  0.8以上 = 理想的な形状（教科書的パターン）\n  0.7-0.8 = 標準的な形状（他指標と併用推奨）\n  0.6-0.7 = やや不明瞭（慎重に判断）\n  0.6未満 = 形状不十分';
			const text = `${hdr}（${typeSummary || '分類なし'}）\n${periodLine ? periodLine + '\n' : ''}\n【検出パターン（全件）】\n${body}${overlayNote}${trustNote}`;
			return { content: [{ type: 'text', text }], structuredContent: res as any };
		}
		// detailed (default): 上位5件
		const top = pats.slice(0, 5);
		const body = top.length ? top.map((p, i) => fmtLine(p, i)).join('\n\n') : '';
		let none = '';
		if (!top.length) {
			const effTol = (meta as any)?.effective_params?.tolerancePct ?? tolerancePct ?? 'default';
			none = `\nパターンは検出されませんでした（tolerancePct=${effTol}）。\n・検討パターン: ${(patterns && patterns.length) ? patterns.join(', ') : '既定セット'}\n・必要に応じて tolerance を 0.03-0.06 に緩和してください`;
		}
		const overlayNote = (res as any)?.data?.overlays ? '\n\nチャート連携: structuredContent.data.overlays を render_chart_svg.overlays に渡すと注釈/範囲を描画できます。' : '';
		const trustNote = '\n\nパターン整合度について（形状一致度・対称性・期間から算出）:\n  0.8以上 = 理想的な形状（教科書的パターン）\n  0.7-0.8 = 標準的な形状（他指標と併用推奨）\n  0.6-0.7 = やや不明瞭（慎重に判断）\n  0.6未満 = 形状不十分';
		const usage = `\n\nusage_example:\n  step1: detect_patterns を実行\n  step2: structuredContent.data.overlays を取得\n  step3: render_chart_svg の overlays に渡す`;
		const text = `${hdr}（${typeSummary || '分類なし'}）\n${periodLine ? periodLine + '\n' : ''}\n${top.length ? '【検出パターン】\n' + body : ''}${none}${overlayNote}${trustNote}${usage}`;
		return { content: [{ type: 'text', text }], structuredContent: { ...res, usage_example: { step1: 'detect_patterns を実行', step2: 'data.overlays を取得', step3: 'render_chart_svg の overlays に渡す' } } as any };
	},
};
