<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { onUnauthorized } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useLocaleStore } from '@/stores/locale'
import { useNoteStore } from '@/stores/note'
import { useThemeStore } from '@/stores/theme'

/**
 * 根组件：注入 Element Plus 全局多语言与主题生命周期初始化
 */
const themeStore = useThemeStore()
const localeStore = useLocaleStore()
const authStore = useAuthStore()
const noteStore = useNoteStore()
const router = useRouter()

onMounted(() => {
  themeStore.initTheme()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = localeStore.locale
  }

  onUnauthorized(() => {
    authStore.clearLocalAuth()
    noteStore.reset()
    if (router.currentRoute.value.name !== 'login') {
      router.replace({ name: 'login' })
    }
  })
})
</script>

<template>
  <el-config-provider :locale="localeStore.elementLocale">
    <router-view />
  </el-config-provider>
</template>
