"use client";

import { createContext, useContext, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const TabsContext = createContext<string>("");

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function Tabs({ value, className, ...props }: TabsProps) {
  return (
    <TabsContext.Provider value={value}>
      <div className={cn(className)} {...props} />
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-line bg-sunken p-1",
        className,
      )}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tabValue: string;
}

export function TabsTrigger({ tabValue, className, ...props }: TabsTriggerProps) {
  const active = useContext(TabsContext) === tabValue;
  return (
    <button
      role="tab"
      aria-selected={active}
      type="button"
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ease-out",
        active ? "bg-white/10 text-ink" : "text-ink-dim hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}
