import { useEffect, useState } from 'react'

const PAGE_SIZE = 30

/** 受控分页列表（Req 5.4）：只渲染当前页，避免长表全量重渲染 */
export function usePagination<T>(items: T[]) {
  const [page, setPage] = useState(0)
  const maxPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1)
  useEffect(() => {
    if (page > maxPage) setPage(maxPage)
  }, [maxPage, page])
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  return { page, maxPage, pageItems, setPage, hasPages: items.length > PAGE_SIZE, total: items.length }
}
