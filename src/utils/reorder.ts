/**
 * 拖动排序纯函数工具模块
 * 用于计算文件夹及笔记在拖动放开后的新顺序与排序提交载荷
 */

/**
 * 将列表中的 draggedId 元素移动到 targetId 的前方或后方，返回新数组（不修改原数组）
 */
export function reorderListById<T extends { id: string }>(
  items: T[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after' = 'before'
): T[] {
  if (draggedId === targetId) return [...items]
  const draggedIdx = items.findIndex((item) => item.id === draggedId)
  const targetIdx = items.findIndex((item) => item.id === targetId)
  if (draggedIdx === -1 || targetIdx === -1) return [...items]

  const next = [...items]
  const [moved] = next.splice(draggedIdx, 1)
  const adjustedTargetIdx = next.findIndex((item) => item.id === targetId)
  const insertIdx = position === 'before' ? adjustedTargetIdx : adjustedTargetIdx + 1
  next.splice(insertIdx, 0, moved)
  return next
}

/**
 * 为已排序列表生成连续递增的 sortOrder 更新载荷
 */
export function buildSortPayload<T extends { id: string }>(
  items: T[],
  startOrder = 0
): Array<{ id: string; sortOrder: number }> {
  return items.map((item, index) => ({
    id: item.id,
    sortOrder: startOrder + index
  }))
}
