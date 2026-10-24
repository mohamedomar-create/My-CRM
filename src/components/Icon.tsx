import {
  AlignLeft, Award, Banknote, Calculator, Eye, BarChart3, Boxes, Briefcase, Building, Building2, Calendar, CalendarClock, CheckCircle2, CheckSquare, ClipboardList, Cog,
  BrickWall, CalendarCheck, Car, Droplets, EyeOff, Factory, FileSpreadsheet, FileText, FolderKanban, GraduationCap, Handshake, HardHat, Hash, HeartPulse, Home, Hourglass, Layers,
  LifeBuoy, Link, ListChecks, Magnet, Mail, MailQuestion, Map, MapPin, MessageCircleWarning, Network, Package, PackageX, Percent, Phone, Receipt,
  Plane, ShieldCheck, Ship, ShoppingBag, ShoppingCart, Sigma, Sparkles, Sprout, Stethoscope, Tractor, Star, Store, Tags, Target, Timer, Truck, Type, UserRound, UtensilsCrossed, Users, Users2, UserX, Wrench,
  type LucideIcon,
} from 'lucide-react'

export const ICONS: Record<string, LucideIcon> = {
  AlignLeft, Award, Banknote, Calculator, Eye, BarChart3, Boxes, Briefcase, Building, Building2, Calendar, CalendarClock, CheckCircle2, CheckSquare, ClipboardList, Cog,
  BrickWall, CalendarCheck, Car, Droplets, EyeOff, Factory, FileSpreadsheet, FileText, FolderKanban, GraduationCap, Handshake, HardHat, Hash, HeartPulse, Home, Hourglass, Layers,
  LifeBuoy, Link, ListChecks, Magnet, Mail, MailQuestion, Map, MapPin, MessageCircleWarning, Network, Package, PackageX, Percent, Phone, Receipt,
  Plane, ShieldCheck, Ship, ShoppingBag, ShoppingCart, Sigma, Sparkles, Sprout, Stethoscope, Tractor, Star, Store, Tags, Target, Timer, Truck, Type, UserRound, UtensilsCrossed, Users, Users2, UserX, Wrench,
}

export const MODULE_ICON_CHOICES = ['Building2', 'Users', 'Magnet', 'Handshake', 'Package', 'Home', 'MapPin', 'ClipboardList', 'ShieldCheck', 'FolderKanban', 'Timer', 'Cog', 'Users2', 'Map', 'Truck', 'LifeBuoy', 'CalendarClock', 'Briefcase', 'Award', 'Target', 'Boxes', 'Layers', 'Star', 'HeartPulse']

export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const C = ICONS[name] ?? Layers
  return <C size={size} className={className} style={style} />
}
