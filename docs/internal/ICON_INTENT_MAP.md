# Frapp Icon Intent Map

> Last updated: 2026-03-09  
> Source of truth for semantic intent → icon selection

Use this map to keep icon choices consistent and avoid ad hoc substitutions.

## Mobile (Ionicons)

| Semantic intent | Inactive / neutral | Active / emphasis |
|---|---|---|
| Home tab | `home-outline` | `home` |
| Chat tab | `chatbubbles-outline` | `chatbubbles` |
| Events tab | `calendar-outline` | `calendar` |
| Points tab | `trophy-outline` | `trophy` |
| Profile tab | `person-outline` | `person` |
| More tab | `ellipsis-horizontal-circle-outline` | `ellipsis-horizontal-circle` |

## Web dashboard (Lucide)

| Semantic intent | Icon |
|---|---|
| Overview | `LayoutDashboard` |
| Members | `Users` |
| Events | `CalendarDays` |
| Points | `Star` |
| Billing | `CircleDollarSign` |
| Backwork | `BookOpen` |
| Settings | `Settings` |
| Notifications | `Bell` |
| Theme: system | `Monitor` |
| Theme: light | `Sun` |
| Theme: dark | `Moon` |

## Rules

1. Mobile navigation must use outline icons for neutral and filled icons for active/emphasis.
2. Do not mix icon packs within a single surface.
3. Any new icon choice must be added to this map in the same PR.
