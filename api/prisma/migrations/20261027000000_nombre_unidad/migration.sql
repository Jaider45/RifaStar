-- Cómo se llama cada unidad que se vende en la página pública («número», «boleta», «puesto»…).
ALTER TABLE "raffles" ADD COLUMN     "unit_label" TEXT NOT NULL DEFAULT 'número',
ADD COLUMN     "unit_label_plural" TEXT NOT NULL DEFAULT 'números';

ALTER TABLE "raffles" ADD CONSTRAINT "raffles_unit_labels"
  CHECK (length(unit_label) BETWEEN 2 AND 20 AND length(unit_label_plural) BETWEEN 2 AND 24);
