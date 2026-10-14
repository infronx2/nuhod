'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { LogOut, ChevronDown, Stethoscope, UserRound, KeyRound } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { GradientAvatar } from '@/components/nuhoud/gradient-avatar'
import { ChangePasswordDialog } from '@/components/nuhoud/change-password-dialog'

export function UserMenu() {
  const { user, logout } = useAuth()
  const tc = useTranslations('common')
  const ta = useTranslations('account')
  const [passwordOpen, setPasswordOpen] = React.useState(false)
  if (!user) return null

  const isDoctor = user.role.toUpperCase() === 'DOCTOR' || user.role.toUpperCase() === 'ADMIN'
  const RoleIcon = isDoctor ? Stethoscope : UserRound

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 py-1 ps-1 pe-2 text-sm shadow-sm backdrop-blur transition-colors hover:bg-card/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={tc('signOut')}
        >
          <GradientAvatar seed={user.avatarSeed} name={user.name} size="h-7 w-7" />
          <span className="hidden max-w-[120px] truncate font-medium sm:inline">
            {user.name}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              isDoctor
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'bg-primary/15 text-primary dark:text-primary',
            )}
          >
            <RoleIcon className="h-2.5 w-2.5" />
            {isDoctor ? tc('doctor') ?? 'Doctor' : tc('patient') ?? 'Patient'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </motion.button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-semibold">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setPasswordOpen(true)} className="cursor-pointer gap-2">
          <KeyRound className="h-4 w-4" />
          {ta('changePassword')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void logout()}
          className="cursor-pointer gap-2 text-rose-600 focus:text-rose-700 dark:text-rose-400"
        >
          <LogOut className="h-4 w-4" />
          {tc('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}
