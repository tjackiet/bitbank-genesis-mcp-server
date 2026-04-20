import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillRoot = resolve(__dirname, '../../.claude/skills/mcp-setup');

const skillMdPath = resolve(skillRoot, 'SKILL.md');
const clientConfigsPath = resolve(skillRoot, 'references/client-configs.md');
const privateApiSetupPath = resolve(skillRoot, 'references/private-api-setup.md');

function readFrontmatter(filePath: string): Record<string, string> {
	const content = readFileSync(filePath, 'utf8');
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const block = match[1];
	const result: Record<string, string> = {};
	let currentKey: string | null = null;
	let currentValue = '';
	let inBlock = false;

	for (const line of block.split(/\r?\n/)) {
		const topLevel = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
		if (topLevel && !line.startsWith(' ')) {
			if (currentKey !== null) {
				result[currentKey] = currentValue.trim();
			}
			currentKey = topLevel[1];
			const rest = topLevel[2];
			if (rest === '|' || rest === '>') {
				inBlock = true;
				currentValue = '';
			} else {
				inBlock = false;
				currentValue = rest;
			}
		} else if (inBlock && currentKey !== null) {
			currentValue += `${line.replace(/^ {2}/, '')}\n`;
		}
	}
	if (currentKey !== null) {
		result[currentKey] = currentValue.trim();
	}
	return result;
}

describe('mcp-setup skill', () => {
	it('SKILL.md が存在する', () => {
		expect(existsSync(skillMdPath)).toBe(true);
	});

	it('SKILL.md の frontmatter に必須フィールドがある', () => {
		const fm = readFrontmatter(skillMdPath);
		expect(fm.name).toBe('mcp-setup');
		expect(fm.description).toBeTruthy();
		expect(fm.description.length).toBeGreaterThan(0);
	});

	it('description は 1024 文字以内である', () => {
		const fm = readFrontmatter(skillMdPath);
		expect(fm.description.length).toBeLessThanOrEqual(1024);
	});

	it('description に代表的なトリガーフレーズが含まれる', () => {
		const fm = readFrontmatter(skillMdPath);
		expect(fm.description).toMatch(/bitbank/);
		expect(fm.description).toMatch(/MCP/);
		expect(fm.description).toMatch(/セットアップ|接続/);
	});

	it('references/client-configs.md が存在する', () => {
		expect(existsSync(clientConfigsPath)).toBe(true);
	});

	it('references/private-api-setup.md が存在する', () => {
		expect(existsSync(privateApiSetupPath)).toBe(true);
	});

	it('client-configs.md に主要クライアントの記載がある', () => {
		const content = readFileSync(clientConfigsPath, 'utf8');
		expect(content).toMatch(/Claude Desktop/);
		expect(content).toMatch(/Claude Code/);
		expect(content).toMatch(/Cursor/);
		expect(content).toMatch(/Windsurf/);
		expect(content).toMatch(/@tjackiet\/bitbank-mcp/);
	});

	it('private-api-setup.md に API キー発行手順とセキュリティ注意がある', () => {
		const content = readFileSync(privateApiSetupPath, 'utf8');
		expect(content).toMatch(/BITBANK_API_KEY/);
		expect(content).toMatch(/BITBANK_API_SECRET/);
		expect(content).toMatch(/app\.bitbank\.cc\/account\/api/);
		expect(content).toMatch(/\.gitignore/);
	});
});
