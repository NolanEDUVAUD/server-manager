import type { Dict } from "..";

export const orgFields: Dict["orgFields"] = {
  legend: "Organisation",
  tags: "Tags",
  noTags: "No tags: create them with “Organise” on the Servers or Services page.",
  folder: "Folder",
  customFields: "Custom fields",
  customFieldsInfo:
    "Free-form information (location, serial number, warranty…). Not encrypted and included in exports: never put a password, token or key here.",
  keyPlaceholder: "Location",
  valuePlaceholder: "Rack 2, top shelf",
  keyAria: "Key of field {n}",
  valueAria: "Value of field {n}",
  removeAria: "Delete field {n}",
  sensitive:
    "“{key}” looks like a secret: these fields are not encrypted. Keep passwords in the SSH field (encrypted) or in a password manager.",
  addField: "Add a field",
  removeTag: "Remove tag {name}",
  addFavorite: "Add {name} to favourites",
  removeFavorite: "Remove {name} from favourites",
  errors: {
    nameRequired: "Name required",
    nameTooLong: "{max} characters at most",
    nameTaken: "This name already exists",
    keyRequired: "Key required",
    keyTooLong: "Key: {max} characters at most",
    valueTooLong: "Value: {max} characters at most",
    duplicateKey: "Duplicate key",
    tooMany: "{max} fields at most",
  },
};
