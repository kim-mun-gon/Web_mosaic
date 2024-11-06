const express = require('express');
const puppeteer = require('puppeteer');
const { URL } = require('url');
const path = require('path');
const app = express();
const PORT = 3000;

// 정적 파일 제공을 위해 public 디렉토리 설정
app.use(express.static(path.join(__dirname, 'public')));

// 루트 경로 핸들러 추가
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Puppeteer로 웹사이트를 처리하고 응답하는 엔드포인트 설정
app.get('/proxy', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).send('URL is required');
    }

    try {
        // URL 유효성 검사
        let targetUrl;
        try {
            targetUrl = new URL(url);
        } catch (error) {
            return res.status(400).send('Invalid URL format');
        }

        // Puppeteer를 이용해 페이지를 렌더링
        const browser = await puppeteer.launch({
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ],
            headless: true
        });

        const page = await browser.newPage();

        // User-Agent 및 기타 헤더 설정
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
        });

        // CSP 우회 설정 및 페이지 이동, 타임아웃을 길게 설정하여 시도 (60초)
        await page.setBypassCSP(true);
        await page.goto(targetUrl.href, { waitUntil: 'networkidle2', timeout: 60000 });

        // 페이지 스크롤 시뮬레이션을 통해 동적 콘텐츠 로드
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        // 이미지, 동영상 및 ::after 블러 처리 (CSS filter 속성 이용)
        await page.evaluate(() => {
            const blurElements = () => {
                const elements = document.querySelectorAll('img, div.thumb-container img, video');
                elements.forEach(element => {
                    element.style.filter = 'blur(10px)';
                });

                // ::after 가상 요소 블러 처리
                const styleSheet = document.createElement("style");
                styleSheet.type = "text/css";
                styleSheet.innerText = `
                    *::after {
                        filter: blur(10px) !important;
                    }
                `;
                document.head.appendChild(styleSheet);
            };

            // 초기 로딩 시 블러 적용
            blurElements();

            // MutationObserver를 사용하여 동적 콘텐츠에 블러 처리 적용
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.addedNodes.length) {
                        blurElements();
                    }
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });

        // 모든 상대 경로를 절대 경로로 변경하고, 링크와 폼이 프록시를 통해 라우팅되도록 설정
        await page.evaluate((baseUrl) => {
            const base = new URL(baseUrl);
            document.querySelectorAll('a, link, script, img, form').forEach(element => {
                const attr = element.tagName === 'A' || element.tagName === 'LINK' ? 'href' : 'src';
                if (element[attr] && !element[attr].startsWith('http')) {
                    element[attr] = new URL(element[attr], base).href;
                }
                if (element.tagName === 'A' && element.href) {
                    // 링크 클릭 시 프록시를 통해 이동하도록 수정
                    element.href = `/proxy?url=${encodeURIComponent(element.href)}`;
                }
                if (element.tagName === 'FORM' && element.action) {
                    // 폼 제출 시 프록시를 통해 이동하도록 수정
                    element.action = `/proxy?url=${encodeURIComponent(element.action)}`;
                }
            });
        }, targetUrl.href);

        // 블러가 적용된 HTML을 가져와 클라이언트로 반환
        const content = await page.content();
        await browser.close();
        res.send(content);
    } catch (error) {
        console.error('Error fetching the website:', error);
        res.status(500).send('웹사이트를 가져오는 중 오류가 발생했습니다.');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
