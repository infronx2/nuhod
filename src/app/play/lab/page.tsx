import { notFound } from 'next/navigation'
import { HandLab } from '@/components/play/hand-lab'

/** /play/lab: the hand lab, a development tool for checking the hand rig. Not served in production. */
export default function HandLabPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <HandLab />
}
