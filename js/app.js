// Chromind ツールキットの主要なフロントエンド処理。
(() => {
	'use strict';

	// 各フォーム要素や出力先をキャッシュして再利用コストを抑える。
	const paletteForm = document.getElementById('palette-form');
	const baseColorInput = document.getElementById('base-color');
	const baseColorText = document.getElementById('base-color-text');
	const paletteResults = document.getElementById('palette-results');
	const paletteCountRange = document.getElementById('palette-count');
	const paletteCountValue = document.getElementById('palette-count-value');

	const refreshPalette = () => {
		paletteForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	};

	const simulationForm = document.getElementById('simulation-form');
	const simulationTableBody = document.querySelector('#simulation-table tbody');
	const simulationCanvas = document.getElementById('simulation-chart');
	const ctx = simulationCanvas.getContext('2d');

	const randomForm = document.getElementById('random-form');
	const paletteSizeRange = document.getElementById('palette-size');
	const paletteSizeValue = document.getElementById('palette-size-value');
	const randomResults = document.getElementById('random-results');

	// 入力された HEX 値を正規化するためのヘルパー群。
	const clampHex = (value) => value.replace(/[^0-9a-f]/gi, '').slice(0, 6);

	const normalizeHex = (value) => {
		const trimmed = value.trim().toLowerCase();
		const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
		if (withoutHash.length !== 6) {
			throw new Error('#RRGGBB 形式で入力してください。');
		}
		return `#${withoutHash}`;
	};

	const hexToRgb = (hex) => {
		const normalized = normalizeHex(hex);
		const num = parseInt(normalized.slice(1), 16);
		return {
			r: (num >> 16) & 0xff,
			g: (num >> 8) & 0xff,
			b: num & 0xff,
		};
	};

	const rgbToHex = (r, g, b) => {
		const toHex = (x) => x.toString(16).padStart(2, '0');
		return `#${toHex(Math.max(0, Math.min(255, Math.round(r))))}${toHex(
			Math.max(0, Math.min(255, Math.round(g)))
		)}${toHex(Math.max(0, Math.min(255, Math.round(b))))}`;
	};

	const rgbToHsl = ({ r, g, b }) => {
		const r1 = r / 255;
		const g1 = g / 255;
		const b1 = b / 255;
		const max = Math.max(r1, g1, b1);
		const min = Math.min(r1, g1, b1);
		let h = 0;
		let s = 0;
		const l = (max + min) / 2;

		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			switch (max) {
				case r1:
					h = (g1 - b1) / d + (g1 < b1 ? 6 : 0);
					break;
				case g1:
					h = (b1 - r1) / d + 2;
					break;
				default:
					h = (r1 - g1) / d + 4;
			}
			h /= 6;
		}
		return { h, s, l };
	};

	const hslToRgb = ({ h, s, l }) => {
		if (s === 0) {
			const gray = l * 255;
			return { r: gray, g: gray, b: gray };
		}

		const hue2rgb = (p, q, t) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};

		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;

		const r = hue2rgb(p, q, h + 1 / 3) * 255;
		const g = hue2rgb(p, q, h) * 255;
		const b = hue2rgb(p, q, h - 1 / 3) * 255;

		return { r, g, b };
	};

	// 指定角度で色相を回転させ、カラーハーモニーを組み立てる。
	const rotateHue = (hex, degrees) => {
		const hsl = rgbToHsl(hexToRgb(hex));
		const rotated = { ...hsl, h: (hsl.h + degrees / 360) % 1 };
		if (rotated.h < 0) rotated.h += 1;
		const { r, g, b } = hslToRgb(rotated);
		return rgbToHex(r, g, b);
	};
	// 明度を調整してニュートラルやサポートカラーを作る。
	const adjustLightness = (hex, delta) => {
		const hsl = rgbToHsl(hexToRgb(hex));
		const adjusted = {
			...hsl,
			l: Math.max(0, Math.min(1, hsl.l + delta)),
		};
		const { r, g, b } = hslToRgb(adjusted);
		return rgbToHex(r, g, b);
	};

	const relativeLuminance = (hex) => {
		const { r, g, b } = hexToRgb(hex);
		const toLinear = (channel) => {
			const c = channel / 255;
			return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
		};
		const rl = toLinear(r);
		const gl = toLinear(g);
		const bl = toLinear(b);
		return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
	};

	const chooseTextColor = (hex) => (relativeLuminance(hex) > 0.55 ? '#111111' : '#ffffff');

	const isLightColor = (hex) => relativeLuminance(hex) > 0.6;

	const ensureAccentContrast = (baseHex, accentHex) => {
		const base = normalizeHex(baseHex);
		const accent = normalizeHex(accentHex);
		const baseLum = relativeLuminance(base);
		const accentLum = relativeLuminance(accent);
		const contrast = (Math.max(baseLum, accentLum) + 0.05) / (Math.min(baseLum, accentLum) + 0.05);

		if (accent === base || contrast < 2.5) {
			const baseHsl = rgbToHsl(hexToRgb(base));
			const adjusted = {
				h: (baseHsl.h + 0.5) % 1,
				s: Math.max(0.6, 1 - baseHsl.s),
				l: baseHsl.l > 0.5 ? 0.32 : 0.68,
			};
			const { r, g, b } = hslToRgb(adjusted);
			return rgbToHex(r, g, b);
		}

		return accent;
	};

	const createPaletteSuggestions = (baseHex, desiredCount) => {
		const normalized = normalizeHex(baseHex);
		const rawComplement = rotateHue(normalized, 180);
		const primaryAccent = ensureAccentContrast(normalized, rawComplement);

		const analogWarm = rotateHue(normalized, 30);
		const analogCool = rotateHue(normalized, -30);
		const secondary = rotateHue(normalized, 120);
		const tertiary = rotateHue(normalized, -120);
		const neutralShift = isLightColor(normalized) ? -0.22 : 0.22;
		const neutral = adjustLightness(normalized, neutralShift);
		const highlight = adjustLightness(normalized, 0.18);
		const shadow = adjustLightness(normalized, -0.18);
		const vividAnalog = adjustLightness(analogWarm, -0.05);
		const softAnalog = adjustLightness(analogCool, 0.12);

		const count = Math.max(2, Math.min(desiredCount || 4, 7));

		const candidates = [
			{ hex: normalized, role: 'ベース', isAccent: false },
			{ hex: primaryAccent, role: 'アクセント', isAccent: true },
			{ hex: vividAnalog, role: 'サブアクセント', isAccent: false },
			{ hex: softAnalog, role: 'バランス', isAccent: false },
			{ hex: secondary, role: 'コントラスト', isAccent: false },
			{ hex: tertiary, role: 'コントラスト 2', isAccent: false },
			{ hex: neutral, role: 'ニュートラル', isAccent: false },
			{ hex: highlight, role: 'ハイライト', isAccent: false },
			{ hex: shadow, role: 'シャドウ', isAccent: false },
		];

		const seen = new Set();
		const unique = [];
		for (const candidate of candidates) {
			const key = candidate.hex.toUpperCase();
			if (seen.has(key)) continue;
			seen.add(key);
			unique.push(candidate);
		}

		let customPalette;
		if (count === 2) {
			let analogAccent = vividAnalog;
			if (analogAccent.toUpperCase() === normalized.toUpperCase()) {
				analogAccent = ensureAccentContrast(normalized, rotateHue(normalized, 45));
			}
			customPalette = [
				{ hex: normalized, role: 'ベース', isAccent: false },
				{ hex: analogAccent, role: 'アクセント', isAccent: true },
			];
		} else {
			if (unique.length < count) {
				const baseHsl = rgbToHsl(hexToRgb(normalized));
				while (unique.length < count) {
					const offset = (unique.length + 1) * 0.08;
					const alt = hslToRgb({
						h: (baseHsl.h + offset) % 1,
						s: Math.min(1, Math.max(0.45, baseHsl.s + offset)),
						l: Math.min(
							0.8,
							Math.max(0.2, baseHsl.l + (unique.length % 2 === 0 ? offset : -offset))
						),
					});
					const hex = rgbToHex(alt.r, alt.g, alt.b);
					if (!seen.has(hex.toUpperCase())) {
						seen.add(hex.toUpperCase());
						unique.push({
							hex,
							role: `バリエーション ${unique.length}`,
							isAccent: false,
						});
					} else {
						break;
					}
				}
			}

			const paletteSize = Math.min(count, unique.length);
			const accentIndex = unique.findIndex((item) => item.isAccent);
			if (accentIndex > 1 && accentIndex < paletteSize) {
				const accent = unique.splice(accentIndex, 1)[0];
				unique.splice(1, 0, accent);
			}
			customPalette = unique.slice(0, paletteSize);
		}

		return [
			{
				title: '補色ペア',
				subtitle: 'ベースと補色アクセントの 2 色セット。',
				colors: [
					{ hex: normalized, role: 'ベース', isAccent: false },
					{ hex: primaryAccent, role: '補色アクセント', isAccent: true },
				],
			},
			{
				title: `${customPalette.length} 色提案`,
				subtitle: `選択した色数でアクセント入りの提案です。`,
				colors: customPalette,
			},
		];
	};

	// 単色スウォッチとコピー操作を組み立てる。
	const buildSwatch = ({ hex, role = 'カラー', isAccent = false }) => {
		const swatch = document.createElement('div');
		swatch.className = 'swatch';
		if (isAccent) {
			swatch.classList.add('swatch--accent');
		}
		swatch.style.background = hex;
		const textColor = chooseTextColor(hex);
		swatch.style.color = textColor;
		if (textColor === '#111111') {
			swatch.classList.add('swatch--light');
		}

		const roleLabel = document.createElement('span');
		roleLabel.className = 'swatch__role';
		roleLabel.textContent = role;

		const label = document.createElement('span');
		label.className = 'swatch__hex';
		label.textContent = hex.toUpperCase();

		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'swatch__copy';
		button.textContent = 'コピー';
		button.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(hex.toUpperCase());
				button.textContent = 'コピー済み';
				setTimeout(() => {
					button.textContent = 'コピー';
				}, 1500);
			} catch (error) {
				console.error('コピーに失敗しました', error);
			}
		});

		swatch.append(roleLabel, label, button);
		return swatch;
	};

	// ハーモニーごとにスウォッチ群をまとめたグループを生成する。
	const buildPaletteGroup = ({ title, subtitle, colors }) => {
		const group = document.createElement('div');
		group.className = 'palette-group';

		const heading = document.createElement('div');
		heading.className = 'palette-group__title';
		heading.innerHTML = `<span>${title}</span><span>${colors.length} 色</span>`;
		group.appendChild(heading);

		if (subtitle) {
			const description = document.createElement('p');
			description.className = 'palette-group__subtitle';
			description.textContent = subtitle;
			group.appendChild(description);
		}

		const row = document.createElement('div');
		row.className = 'swatch-row';
		colors.forEach((color) => row.appendChild(buildSwatch(color)));
		group.appendChild(row);

		return group;
	};

	// ベースカラー入力と色数から配色提案を生成し表示する。
	paletteForm.addEventListener('submit', (event) => {
		event.preventDefault();
		try {
			const count = Number(paletteCountRange?.value ?? 4);
			const suggestions = createPaletteSuggestions(baseColorText.value, count);
			paletteResults.innerHTML = '';
			suggestions.forEach((plan) => {
				paletteResults.appendChild(buildPaletteGroup(plan));
			});
		} catch (error) {
			paletteResults.innerHTML = `<p>${error.message}</p>`;
		}
	});

	baseColorInput.addEventListener('input', () => {
		baseColorText.value = baseColorInput.value.toLowerCase();
		refreshPalette();
	});

	baseColorText.addEventListener('input', () => {
		const cleaned = clampHex(baseColorText.value);
		baseColorText.value = `#${cleaned}`;
		if (cleaned.length === 6) {
			baseColorInput.value = `#${cleaned}`;
			refreshPalette();
		}
	});

	// オイラー法を用いたロトカ・ヴォルテラ方程式の数値シミュレーション。
	const simulate = (params) => {
		const { alpha, beta, gamma, delta, preyInitial, predatorInitial, steps, dt } = params;

		let prey = preyInitial;
		let predator = predatorInitial;
		const history = [{ prey, predator }];
		for (let i = 0; i < steps; i++) {
			const preyGrowth = alpha * prey;
			const predation = beta * prey * predator;
			const predatorGrowth = delta * prey * predator;
			const predatorDeath = gamma * predator;

			prey += (preyGrowth - predation) * dt;
			predator += (predatorGrowth - predatorDeath) * dt;

			history.push({
				prey: Math.max(prey, 0),
				predator: Math.max(predator, 0),
			});
		}
		return history;
	};

	// 計算結果をキャンバスに描画し、捕食・被捕食の推移を可視化する。
	const drawChart = (history) => {
		const width = simulationCanvas.width;
		const height = simulationCanvas.height;
		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);

		const maxValue = Math.max(...history.map((entry) => Math.max(entry.prey, entry.predator)), 1);

		const padding = 40;
		const plotWidth = width - padding * 2;
		const plotHeight = height - padding * 2;

		ctx.strokeStyle = '#e5e7eb';
		ctx.lineWidth = 1;
		ctx.strokeRect(padding, padding, plotWidth, plotHeight);

		const drawSeries = (color, accessor) => {
			ctx.strokeStyle = color;
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			history.forEach((entry, index) => {
				const x = padding + (plotWidth * index) / (history.length - 1);
				const y = padding + plotHeight - (plotHeight * accessor(entry)) / maxValue;
				if (index === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			});
			ctx.stroke();
		};

		drawSeries('#3b82f6', (entry) => entry.prey);
		drawSeries('#ef4444', (entry) => entry.predator);

		ctx.fillStyle = '#1f2937';
		ctx.font = '14px Inter, sans-serif';
		ctx.fillText('被捕食者', padding + 10, padding + 20);
		ctx.fillText('捕食者', padding + 110, padding + 20);

		ctx.fillStyle = '#3b82f6';
		ctx.fillRect(padding, padding + 26, 12, 12);
		ctx.fillStyle = '#ef4444';
		ctx.fillRect(padding + 100, padding + 26, 12, 12);
	};

	// 表では行数を制限して可読性を確保しつつ結果を提示する。
	const renderTable = (history) => {
		simulationTableBody.innerHTML = '';
		const displayLimit = Math.min(history.length, 60);
		for (let i = 0; i < displayLimit; i++) {
			const row = document.createElement('tr');
			const stepCell = document.createElement('td');
			stepCell.textContent = i.toString();
			const preyCell = document.createElement('td');
			preyCell.textContent = history[i].prey.toFixed(2);
			const predatorCell = document.createElement('td');
			predatorCell.textContent = history[i].predator.toFixed(2);
			row.append(stepCell, preyCell, predatorCell);
			simulationTableBody.appendChild(row);
		}
		if (history.length > displayLimit) {
			const ellipsis = document.createElement('tr');
			const cell = document.createElement('td');
			cell.colSpan = 3;
			cell.textContent = '… 続きは上のグラフをご確認ください';
			ellipsis.appendChild(cell);
			simulationTableBody.appendChild(ellipsis);
			const last = history[history.length - 1];
			const row = document.createElement('tr');
			const stepCell = document.createElement('td');
			stepCell.textContent = (history.length - 1).toString();
			const preyCell = document.createElement('td');
			preyCell.textContent = last.prey.toFixed(2);
			const predatorCell = document.createElement('td');
			predatorCell.textContent = last.predator.toFixed(2);
			row.append(stepCell, preyCell, predatorCell);
			simulationTableBody.appendChild(row);
		}
	};

	// シミュレーションフォーム送信時に新しい履歴と描画を更新する。
	simulationForm.addEventListener('submit', (event) => {
		event.preventDefault();
		const formData = new FormData(simulationForm);
		const params = Object.fromEntries(formData.entries());
		const parsed = {
			alpha: Number(params.alpha),
			beta: Number(params.beta),
			gamma: Number(params.gamma),
			delta: Number(params.delta),
			preyInitial: Number(params.preyInitial),
			predatorInitial: Number(params.predatorInitial),
			steps: Number(params.steps),
			dt: Number(params.dt),
		};

		const history = simulate(parsed);
		drawChart(history);
		renderTable(history);
	});

	const randomInt = (min, max, rng) => Math.floor(rng() * (max - min + 1)) + min;

	const createSeededRng = (seed) => {
		let t = seed >>> 0;
		return () => {
			t += 0x6d2b79f5;
			let r = t;
			r = Math.imul(r ^ (r >>> 15), r | 1);
			r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
			return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
		};
	};

	const createCryptoRng = () => {
		return () => {
			const buffer = new Uint32Array(1);
			window.crypto.getRandomValues(buffer);
			return buffer[0] / 4294967296;
		};
	};

	const randomPalette = (size, seed) => {
		const rng = Number.isFinite(seed) ? createSeededRng(seed) : createCryptoRng();
		const colors = [];
		for (let i = 0; i < size; i++) {
			const r = randomInt(0, 255, rng);
			const g = randomInt(0, 255, rng);
			const b = randomInt(0, 255, rng);
			colors.push(rgbToHex(r, g, b).toUpperCase());
		}
		return colors;
	};

	// 指定色数・シードに基づいてランダムパレットを生成。
	randomForm.addEventListener('submit', (event) => {
		event.preventDefault();
		const size = Number(paletteSizeRange.value);
		const seedValue = randomForm.seed.value;
		const seed = seedValue === '' ? undefined : Number(seedValue);
		const colors = randomPalette(size, seed);
		randomResults.innerHTML = '';
		const subtitleParts = [`${size} 色`];
		if (seedValue !== '') {
			subtitleParts.push(`シード ${seedValue}`);
		}
		randomResults.appendChild(
			buildPaletteGroup({
				title: 'ランダムパレット',
				subtitle: subtitleParts.join(' ・ '),
				colors: colors.map((hex, index) => ({
					hex,
					role: `カラー ${index + 1}`,
					isAccent: false,
				})),
			})
		);
	});

	paletteSizeRange.addEventListener('input', () => {
		paletteSizeValue.textContent = paletteSizeRange.value;
	});

	if (paletteCountRange && paletteCountValue) {
		paletteCountValue.textContent = paletteCountRange.value;
		paletteCountRange.addEventListener('input', () => {
			paletteCountValue.textContent = paletteCountRange.value;
			refreshPalette();
		});
	}

	// 初期表示を整えるためのデフォルト実行
	// 初期状態で各セクションに内容を表示しておく。
	refreshPalette();
	simulationForm.dispatchEvent(new Event('submit'));
	randomForm.dispatchEvent(new Event('submit'));
})();
