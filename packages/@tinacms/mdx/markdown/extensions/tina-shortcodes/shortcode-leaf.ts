import { codes } from 'micromark-util-symbol/codes'
import type { Construct, Tokenizer, State, Code } from 'micromark-util-types'
import {
  asciiAlpha,
  asciiAlphanumeric,
  markdownLineEnding,
  markdownLineEndingOrSpace,
  markdownSpace,
} from 'micromark-util-character'
import { factorySpace } from 'micromark-factory-space'
import { types } from 'micromark-util-symbol/types'
import { values } from 'micromark-util-symbol/values'
import { factoryWhitespace } from 'micromark-factory-whitespace'

// This should be passed in as an arg
const startPattern = '{{<'
const endPattern = '>}}'

const findValue = (string: string): string | null => {
  let lookupValue: string | null = null
  Object.entries(values).forEach(([key, value]) => {
    if (value === string) {
      lookupValue = key
    }
  })
  return lookupValue
}
export const findCode = (string: string): number | null => {
  const lookup = findValue(string)
  let lookupValue: number | null = null
  if (lookup) {
    Object.entries(codes).forEach(([key, value]) => {
      if (key === lookup) {
        lookupValue = value
      }
    })
  }
  return lookupValue
}

const tokenizeDirectiveLeaf: Tokenizer = function (effects, ok, nok) {
  const self = this
  const logSelf = () => {
    self.events.forEach((e) => {
      console.log(`${e[0]} - ${e[1].type}`)
    })
  }

  let startIndex = 0
  let endIndex = 0

  const start: State = function (code) {
    effects.enter('shortcode')
    effects.enter('shortcodeOpen')
    effects.consume(code)
    if (startPattern.length - 1 === startIndex) {
      effects.exit('shortcodeOpen')
      return startName
    } else {
      startIndex = startIndex + 1
      return startSequence
    }
  }

  const startSequence: State = function (code) {
    const nextItem = startPattern[startIndex]
    if (code === findCode(nextItem)) {
      effects.consume(code)
      if (startPattern.length - 1 === startIndex) {
        effects.exit('shortcodeOpen')
        return startName
      } else {
        startIndex = startIndex + 1
        return startSequence
      }
    }

    return nok(code)
  }

  const startName: State = function (code) {
    if (markdownSpace(code)) {
      return factorySpace(effects, startName, types.whitespace)(code)
    }
    if (asciiAlpha(code)) {
      effects.enter('shortcodeName')
      effects.consume(code)
      return nameName
    }

    return nok(code)
  }

  const nameName: State = function (code) {
    if (
      code === codes.dash ||
      code === codes.underscore ||
      asciiAlphanumeric(code)
    ) {
      effects.consume(code)
      return nameName
    }

    effects.exit('shortcodeName')
    return self.previous === codes.dash || self.previous === codes.underscore
      ? nok(code)
      : attributes(code)
  }

  const attributes: State = function (code) {
    if (markdownSpace(code)) {
      return factorySpace(effects, attributes, types.whitespace)(code)
    }
    if (
      code === codes.dash ||
      code === codes.underscore ||
      asciiAlphanumeric(code)
    ) {
      return between(code)
    }
    if (code === findCode(endPattern[endIndex])) {
      effects.enter('shortcodeClose')
      effects.consume(code)
      if (endPattern.length - 1 === endIndex) {
        effects.exit('shortcodeClose')
        return end
      } else {
        endIndex = endIndex + 1
        return endSequence
      }
    }
    return nok(code)
  }

  // TODO: this breaks the attributes, same logic
  // needed over there
  const endSequence: State = function (code) {
    const nextItem = endPattern[endIndex]
    if (code === findCode(nextItem)) {
      effects.consume(code)
      if (endPattern.length - 1 === endIndex) {
        effects.exit('shortcodeClose')
        return end
      } else {
        endIndex = endIndex + 1
        return endSequence
      }
    }

    return nok(code)
  }
  const end: State = function (code) {
    // TODO: not supporting other text on this line
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit('shortcode')
      return ok(code)
    }

    return nok(code)
  }

  const okInside = end
  const between: State = function (code) {
    const disallowEol = true
    let marker: Code | undefined

    const end: State = function (code) {
      const nextItem = endPattern[endIndex]
      if (code === findCode(nextItem)) {
        if (endPattern.length - 1 === endIndex) {
          effects.enter('directiveLeafAttributesMarker')
          effects.consume(code)
          effects.exit('directiveLeafAttributesMarker')
          effects.exit('directiveLeafAttributes')
          effects.exit('shortcodeClose')
          return okInside
        } else {
          effects.exit('directiveLeafAttributes')
          effects.enter('shortcodeClose')
          effects.consume(code)
          endIndex = endIndex + 1
          return endSequence
        }
      }

      return nok(code)
    }

    const valueQuotedAfter: State = function (code) {
      return code === codes.rightCurlyBrace || markdownLineEndingOrSpace(code)
        ? between(code)
        : end(code)
    }
    const valueQuoted: State = function (code) {
      if (code === marker || code === codes.eof || markdownLineEnding(code)) {
        effects.exit('directiveLeafAttributeValueData')
        return valueQuotedBetween(code)
      }

      effects.consume(code)
      return valueQuoted
    }
    const valueQuotedBetween: State = function (code) {
      if (code === marker) {
        effects.exit('directiveLeafAttributeValue')
        return valueQuotedStart(code)
      }

      if (code === codes.eof) {
        return nok(code)
      }

      // Note: blank lines can’t exist in content.
      if (markdownLineEnding(code)) {
        return disallowEol
          ? nok(code)
          : factoryWhitespace(effects, valueQuotedBetween)(code)
      }

      effects.enter('directiveLeafAttributeValueData')
      effects.consume(code)
      return valueQuoted
    }

    const valueQuotedStart: State = function (code) {
      if (code === marker) {
        effects.enter('directiveLeafAttributeValueMarker')
        effects.consume(code)
        effects.exit('directiveLeafAttributeValueMarker')
        effects.exit('directiveLeafAttributeValueLiteral')
        effects.exit('directiveLeafAttribute')
        return valueQuotedAfter
      }

      effects.enter('directiveLeafAttributeValue')
      return valueQuotedBetween(code)
    }

    const valueUnquoted: State = function (code) {
      if (
        code === codes.eof ||
        code === codes.quotationMark ||
        code === codes.apostrophe ||
        code === codes.lessThan ||
        code === codes.equalsTo ||
        code === codes.greaterThan ||
        code === codes.graveAccent
      ) {
        return nok(code)
      }

      if (code === codes.rightCurlyBrace || markdownLineEndingOrSpace(code)) {
        effects.exit('directiveLeafAttributeValueData')
        effects.exit('directiveLeafAttributeValue')
        effects.exit('directiveLeafAttribute')
        return between(code)
      }

      effects.consume(code)
      return valueUnquoted
    }

    const valueBefore: State = function (code) {
      if (
        code === codes.eof ||
        code === codes.lessThan ||
        code === codes.equalsTo ||
        code === codes.greaterThan ||
        code === codes.graveAccent ||
        code === codes.rightCurlyBrace ||
        (disallowEol && markdownLineEnding(code))
      ) {
        return nok(code)
      }

      if (code === codes.quotationMark || code === codes.apostrophe) {
        effects.enter('directiveLeafAttributeValueLiteral')
        effects.enter('directiveLeafAttributeValueMarker')
        effects.consume(code)
        effects.exit('directiveLeafAttributeValueMarker')
        marker = code
        return valueQuotedStart
      }

      if (disallowEol && markdownSpace(code)) {
        return factorySpace(effects, valueBefore, types.whitespace)(code)
      }

      if (!disallowEol && markdownLineEndingOrSpace(code)) {
        return factoryWhitespace(effects, valueBefore)(code)
      }

      effects.enter('directiveLeafAttributeValue')
      effects.enter('directiveLeafAttributeValueData')
      effects.consume(code)
      marker = undefined
      return valueUnquoted
    }

    const nameAfter: State = function (code) {
      if (code === codes.equalsTo) {
        effects.enter('directiveLeafAttributeInitializerMarker')
        effects.consume(code)
        effects.exit('directiveLeafAttributeInitializerMarker')
        return valueBefore
      }

      // Attribute w/o value.
      effects.exit('directiveLeafAttribute')
      return between(code)
    }
    const name: State = function (code) {
      if (
        code === codes.dash ||
        code === codes.dot ||
        code === codes.colon ||
        code === codes.underscore ||
        asciiAlphanumeric(code)
      ) {
        effects.consume(code)
        return name
      }

      effects.exit('directiveLeafAttributeName')

      if (disallowEol && markdownSpace(code)) {
        return factorySpace(effects, nameAfter, types.whitespace)(code)
      }

      if (!disallowEol && markdownLineEndingOrSpace(code)) {
        return factoryWhitespace(effects, nameAfter)(code)
      }

      return nameAfter(code)
    }

    const between: State = function (code) {
      if (
        code === codes.colon ||
        code === codes.underscore ||
        asciiAlpha(code)
      ) {
        effects.enter('directiveLeafAttribute')
        effects.enter('directiveLeafAttributeName')
        effects.consume(code)
        return name
      }

      if (disallowEol && markdownSpace(code)) {
        return factorySpace(effects, between, types.whitespace)(code)
      }

      if (!disallowEol && markdownLineEndingOrSpace(code)) {
        return factoryWhitespace(effects, between)(code)
      }

      return end(code)
    }

    const start: State = function (code) {
      effects.enter('directiveLeafAttributes')
      return between(code)
    }
    return start(code)
  }

  return start
}

export const directiveLeaf: Construct = {
  tokenize: tokenizeDirectiveLeaf,
}
