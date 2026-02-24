import { Browser } from "playwright";
import { SearchResponse, CommandOptions, HtmlResponse } from "./types.js";
/**
 * 执行Google搜索并返回结果
 * @param query 搜索关键词
 * @param options 搜索选项
 * @returns 搜索结果
 */
export declare function googleSearch(query: string, options?: CommandOptions, existingBrowser?: Browser): Promise<SearchResponse>;
/**
 * 获取Google搜索结果页面的原始HTML
 * @param query 搜索关键词
 * @param options 搜索选项
 * @param saveToFile 是否将HTML保存到文件（可选）
 * @param outputPath HTML输出文件路径（可选，默认为'./google-search-html/[query]-[timestamp].html'）
 * @returns 包含HTML内容的响应对象
 */
export declare function getGoogleSearchPageHtml(query: string, options?: CommandOptions, saveToFile?: boolean, outputPath?: string): Promise<HtmlResponse>;
