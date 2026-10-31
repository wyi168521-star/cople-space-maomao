import type { Component } from 'vue'

export interface NavigationItem {
  label: string
  icon: Component
}

export interface NavMember {
  displayName?: string
  avatarUrl?: string
}
