// elements.js - Pure ESM module
import Element from './Element.js'

class DocType extends Element { tag = '!DOCTYPE html'; isVoid = true }

const htmlElements = [
  // Essential elements
  class Html extends Element {
    tag = 'html'

    render() {
      return [new DocType().render(), super.render()].join('')
    }
  },
  
  class Head extends Element { tag = 'head' },
  
  // Document metadata
  class Title extends Element { tag = 'title' },
  class Meta extends Element { tag = 'meta'; isVoid = true },
  class Link extends Element { tag = 'link'; isVoid = true },
  class Base extends Element { tag = 'base'; isVoid = true },
  class Style extends Element { tag = 'style' },
  
  // Scripts and embedded content
  class Script extends Element { tag = 'script' },
  class NoScript extends Element { tag = 'noscript' },
  class IFrame extends Element { tag = 'iframe' },
  class Canvas extends Element { tag = 'canvas' },
  class EmbeddedContent extends Element { tag = 'embed'; isVoid = true },
  class ObjectElement extends Element { tag = 'object' },
  class Parameter extends Element { tag = 'param'; isVoid = true },
  
  class Body extends Element { tag = 'body' },
  
  // Semantic structure elements
  class Header extends Element { tag = 'header' },
  class Nav extends Element { tag = 'nav' },
  class Main extends Element { tag = 'main' },
  class Section extends Element { tag = 'section' },
  class Article extends Element { tag = 'article' },
  class Aside extends Element { tag = 'aside' },
  class Footer extends Element { tag = 'footer' },
  class Address extends Element { tag = 'address' },
  
  // Headings and content grouping
  class H1 extends Element { tag = 'h1' },
  class H2 extends Element { tag = 'h2' },
  class H3 extends Element { tag = 'h3' },
  class H4 extends Element { tag = 'h4' },
  class H5 extends Element { tag = 'h5' },
  class H6 extends Element { tag = 'h6' },
  class P extends Element { tag = 'p' },
  class Div extends Element { tag = 'div' },
  class Span extends Element { tag = 'span' },
  class Br extends Element { tag = 'br'; isVoid = true },
  class Hr extends Element { tag = 'hr'; isVoid = true },
  class Pre extends Element { tag = 'pre' },
  class Blockquote extends Element { tag = 'blockquote' },
  
  // Lists
  class Ul extends Element { tag = 'ul' },
  class Ol extends Element { tag = 'ol' },
  class Li extends Element { tag = 'li' },
  class Dl extends Element { tag = 'dl' },
  class Dt extends Element { tag = 'dt' },
  class Dd extends Element { tag = 'dd' },
  
  // Text formatting
  class Strong extends Element { tag = 'strong' },
  class Em extends Element { tag = 'em' },
  class B extends Element { tag = 'b' },
  class I extends Element { tag = 'i' },
  class U extends Element { tag = 'u' },
  class S extends Element { tag = 's' },
  class Small extends Element { tag = 'small' },
  class Mark extends Element { tag = 'mark' },
  class Del extends Element { tag = 'del' },
  class Ins extends Element { tag = 'ins' },
  class Sub extends Element { tag = 'sub' },
  class Sup extends Element { tag = 'sup' },
  class Code extends Element { tag = 'code' },
  class Kbd extends Element { tag = 'kbd' },
  class Samp extends Element { tag = 'samp' },
  class Var extends Element { tag = 'var' },
  class Time extends Element { tag = 'time' },
  class Data extends Element { tag = 'data' },
  class Abbr extends Element { tag = 'abbr' },
  class Dfn extends Element { tag = 'dfn' },
  class Q extends Element { tag = 'q' },
  class Cite extends Element { tag = 'cite' },
  
  // Links and navigation
  class A extends Element { tag = 'a' },
  
  // Images and media
  class Img extends Element { tag = 'img'; isVoid = true },
  class Picture extends Element { tag = 'picture' },
  class Source extends Element { tag = 'source'; isVoid = true },
  class Audio extends Element { tag = 'audio' },
  class Video extends Element { tag = 'video' },
  class Track extends Element { tag = 'track'; isVoid = true },
  class Figure extends Element { tag = 'figure' },
  class Figcaption extends Element { tag = 'figcaption' },
  
  // Tables
  class Table extends Element { tag = 'table' },
  class Caption extends Element { tag = 'caption' },
  class Colgroup extends Element { tag = 'colgroup' },
  class Col extends Element { tag = 'col'; isVoid = true },
  class Thead extends Element { tag = 'thead' },
  class Tbody extends Element { tag = 'tbody' },
  class Tfoot extends Element { tag = 'tfoot' },
  class Tr extends Element { tag = 'tr' },
  class Th extends Element { tag = 'th' },
  class Td extends Element { tag = 'td' },
  
  // Forms
  class Form extends Element { tag = 'form' },
  class Fieldset extends Element { tag = 'fieldset' },
  class Legend extends Element { tag = 'legend' },
  class Label extends Element { tag = 'label' },
  class Input extends Element { tag = 'input'; isVoid = true },
  class Button extends Element { tag = 'button' },
  class Select extends Element { tag = 'select' },
  class Datalist extends Element { tag = 'datalist' },
  class Optgroup extends Element { tag = 'optgroup' },
  class Option extends Element { tag = 'option' },
  class Textarea extends Element { tag = 'textarea' },
  class Output extends Element { tag = 'output' },
  class Progress extends Element { tag = 'progress' },
  class Meter extends Element { tag = 'meter' },
  
  // Interactive elements
  class Details extends Element { tag = 'details' },
  class Summary extends Element { tag = 'summary' },
  class Dialog extends Element { tag = 'dialog' },
]

const elements = {}
htmlElements.forEach(elem => elements[elem.name] = elem)

export default elements