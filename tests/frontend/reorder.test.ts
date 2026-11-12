import { describe, expect, it } from 'vitest'
import { buildSortPayload, reorderListById } from '@/utils/reorder'

/**
 * 拖动排序纯函数计算单元测试
 */
describe('Drag Reorder Helpers', () => {
  const sample = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('支持将任意节点拖动到目标节点之前或之后且不修改原数组', () => {
    const moveBefore = reorderListById(sample, 'c', 'a', 'before')
    expect(moveBefore.map((x) => x.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(sample.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])

    const moveAfter = reorderListById(sample, 'a', 'c', 'after')
    expect(moveAfter.map((x) => x.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('应能生成带偏移量的有序 sortOrder 批量提交载荷', () => {
    const payload = buildSortPayload(sample, 100)
    expect(payload).toEqual([
      { id: 'a', sortOrder: 100 },
      { id: 'b', sortOrder: 101 },
      { id: 'c', sortOrder: 102 },
      { id: 'd', sortOrder: 103 }
    ])
  })
})
