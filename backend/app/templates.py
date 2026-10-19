"""Starting templates for the admin form builder. Admin can edit everything."""

DEFAULT_RATING_OPTIONS = [
    {"label": "Excellent", "score": 4},
    {"label": "Good", "score": 3},
    {"label": "Average", "score": 2},
    {"label": "Needs improvement", "score": 1},
]


def _cats(*names):
    return [{"name": n, "description": "", "required": True} for n in names]


TEMPLATES = {
    "restaurant": {
        "label": "Restaurant / Cafe",
        "categories": _cats("Food Quality", "Service", "Ambience"),
    },
    "salon": {
        "label": "Salon",
        "categories": _cats("Service Quality", "Staff Professionalism", "Cleanliness"),
    },
    "hotel": {
        "label": "Hotel",
        "categories": _cats("Room Comfort", "Staff Service", "Cleanliness"),
    },
    "software_agency": {
        "label": "Software company / Agency",
        "categories": _cats("Communication", "Delivery", "Work Quality"),
    },
}


def all_templates():
    return [
        {
            "key": key,
            "label": t["label"],
            "categories": t["categories"],
            "rating_options": DEFAULT_RATING_OPTIONS,
        }
        for key, t in TEMPLATES.items()
    ]
