/** Champs d'organisation (tags, dossier, champs personnalisés), puces de tag, favoris et validation */
export const orgFields = {
  legend: "Organisation",
  tags: "Tags",
  noTags: "Aucun tag : crée-les avec « Organiser » sur la page Serveurs.",
  folder: "Dossier",
  customFields: "Champs personnalisés",
  customFieldsInfo:
    "Informations libres (emplacement, numéro de série, garantie…). Non chiffrées et incluses dans les exports : n'y mets jamais de mot de passe, jeton ou clé.",
  keyPlaceholder: "Emplacement",
  valuePlaceholder: "Baie 2, étagère du haut",
  keyAria: "Clé du champ {n}",
  valueAria: "Valeur du champ {n}",
  removeAria: "Supprimer le champ {n}",
  sensitive:
    "« {key} » ressemble à un secret : ces champs ne sont pas chiffrés. Garde les mots de passe dans le champ SSH (chiffré) ou dans un gestionnaire de mots de passe.",
  addField: "Ajouter un champ",
  removeTag: "Retirer le tag {name}",
  addFavorite: "Ajouter {name} aux favoris",
  removeFavorite: "Retirer {name} des favoris",
  errors: {
    nameRequired: "Nom requis",
    nameTooLong: "{max} caractères au plus",
    nameTaken: "Ce nom existe déjà",
    keyRequired: "Clé requise",
    keyTooLong: "Clé : {max} caractères au plus",
    valueTooLong: "Valeur : {max} caractères au plus",
    duplicateKey: "Clé en double",
    tooMany: "{max} champs au plus",
  },
};
