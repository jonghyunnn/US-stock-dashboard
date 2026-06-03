/**
 * HTML 상세페이지를 스마트스토어용 이미지로 변환하는 스크립트
 *
 * 사용법: node scripts/convert-to-images.mjs output/[상품명].html
 *
 * 필요한 패키지 설치:
 *   npm install puppeteer
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const IMAGE_WIDTH = 860;         // 스마트스토어 권장 가로
const MAX_SECTION_HEIGHT = 2000; // 섹션당 최대 세로 (로딩 속도 최적화)

async function convertToImages(htmlFile) {
  const htmlPath = path.resolve(ROOT, htmlFile);

  if (!fs.existsSync(htmlPath)) {
    console.error(`파일을 찾을 수 없습니다: ${htmlPath}`);
    process.exit(1);
  }

  const baseName = path.basename(htmlFile, '.html');
  const outputDir = path.join(ROOT, 'output', `${baseName}-images`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`변환 시작: ${htmlFile}`);
  console.log(`결과 폴더: output/${baseName}-images/`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setViewport({ width: IMAGE_WIDTH, height: 800 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  // 전체 페이지 캡처
  const fullHeight = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewport({ width: IMAGE_WIDTH, height: fullHeight });
  await page.screenshot({
    path: path.join(outputDir, 'full.jpg'),
    type: 'jpeg',
    quality: 90,
    fullPage: true,
  });
  console.log('  ✅ full.jpg 생성 완료');

  // 섹션별 분할 캡처
  const sections = await page.evaluate(() => {
    const elements = document.querySelectorAll('section, footer');
    return Array.from(elements).map((el) => {
      const rect = el.getBoundingClientRect();
      return { top: Math.round(rect.top), height: Math.round(rect.height) };
    });
  });

  let sectionIndex = 1;
  for (const section of sections) {
    const chunks = Math.ceil(section.height / MAX_SECTION_HEIGHT);
    for (let i = 0; i < chunks; i++) {
      const clip = {
        x: 0,
        y: section.top + i * MAX_SECTION_HEIGHT,
        width: IMAGE_WIDTH,
        height: Math.min(MAX_SECTION_HEIGHT, section.height - i * MAX_SECTION_HEIGHT),
      };
      const fileName = `section-${String(sectionIndex).padStart(2, '0')}.jpg`;
      await page.screenshot({
        path: path.join(outputDir, fileName),
        type: 'jpeg',
        quality: 90,
        clip,
      });
      console.log(`  ✅ ${fileName} 생성 완료`);
      sectionIndex++;
    }
  }

  await browser.close();

  console.log('\n이미지 변환이 완료되었습니다!');
  console.log(`\n📁 결과물 위치: output/${baseName}-images/`);
  console.log('\n스마트스토어에 올리는 방법:');
  console.log('1. 스마트스토어 센터 → 상품 등록/수정');
  console.log('2. "상세 설명" 영역 → 에디터에서 "이미지" 버튼 클릭');
  console.log('3. section-01.jpg부터 순서대로 업로드');
  console.log('4. 이미지 사이 간격 없이 붙여서 배치');
  console.log('\n💡 팁: full.jpg는 전체 미리보기용이고,');
  console.log('   실제 업로드는 section 파일들을 순서대로 올리시면 됩니다.');
}

const args = process.argv.slice(2);
if (!args[0]) {
  console.error('사용법: node scripts/convert-to-images.mjs output/[상품명].html');
  process.exit(1);
}

convertToImages(args[0]).catch((err) => {
  console.error('오류 발생:', err.message);
  process.exit(1);
});
