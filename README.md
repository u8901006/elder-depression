# 老年憂鬱症文獻日報

每日自動從 PubMed 搜尋老年憂鬱症（Late-Life Depression / Geriatric Depression）最新研究文獻，由 Zhipu AI 進行分析總結與分類，部署至 GitHub Pages。

## 架構

- **資料來源**: PubMed NCBI E-utilities API
- **AI 分析**: Zhipu GLM-5-Turbo（fallback: GLM-4.7 → GLM-4.7-Flash）
- **搜尋關鍵字**: 涵蓋老年憂鬱症、血管性憂鬱、自殺防治、藥物治療、心理治療、社會孤立、台灣研究等主題
- **執行頻率**: 每日 GMT+8 06:35
- **只總結前 7 天尚未總結的新文獻**

## 網站

🔗 [https://u8901006.github.io/elder-depression/](https://u8901006.github.io/elder-depression/)

## 設定 GitHub Secrets

在 repo Settings > Secrets and variables > Actions 中設定：

- `ZHIPU_API_KEY`: Zhipu AI API Key
- `PUBMED_API_KEY`: (選用) NCBI API Key，提高 PubMed API 速率限制
